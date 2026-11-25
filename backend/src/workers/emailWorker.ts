import { Worker, Job, DelayedError } from 'bullmq';
import { redisForBullMQ } from '../config/redis';
import { sendEmail, checkRateLimit, incrementRateLimit, notifySlackRateLimit } from '../services/emailService';
import { query } from '../db/pool';
import { EmailJob } from '../types';

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5');
const MIN_DELAY_MS = parseInt(process.env.MIN_DELAY_BETWEEN_SENDS_MS || '2000');

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processEmailJob(job: Job<EmailJob>, token?: string): Promise<void> {
  const { id: emailId, userId, senderEmail, senderName, recipientEmail, subject, body, hourlyLimit } = job.data;

  console.log(`🔄 Processing email job ${job.id} for ${recipientEmail}`);

  // Check idempotency: skip if already sent
  const existingResult = await query(
    "SELECT status FROM emails WHERE id = $1",
    [emailId]
  );
  const existing = existingResult.rows[0];
  if (existing?.status === 'sent') {
    console.log(`⏭️ Email ${emailId} already sent, skipping`);
    return;
  }

  // Check rate limit (global + per-sender + optional per-campaign hourlyLimit)
  const { allowed, retryAfterMs } = await checkRateLimit(senderEmail, hourlyLimit);
  if (!allowed) {
    console.log(`🚫 Rate limit hit for sender ${senderEmail}. Delaying job by ${retryAfterMs}ms`);

    // Update DB status to 'delayed'
    await query(
      "UPDATE emails SET status = 'delayed', updated_at = NOW() WHERE id = $1",
      [emailId]
    );

    // Notify Slack (best-effort)
    notifySlackRateLimit(userId, senderEmail).catch(() => {});

    // Delay this job to next available hour window — pass token for lock validation
    await job.moveToDelayed(Date.now() + retryAfterMs, token);
    throw new DelayedError();
  }

  try {
    // Minimum delay to mimic provider throttling
    await sleep(MIN_DELAY_MS);

    // Send the email
    const { messageId, previewUrl } = await sendEmail({
      senderEmail,
      senderName,
      recipientEmail,
      subject,
      body,
      emailId,
      userId,
    });

    // Increment rate limit counters (Redis-backed) AFTER successful send
    await incrementRateLimit(senderEmail);

    // Update DB: mark as sent — store previewUrl in job_id column for now
    await query(
      `UPDATE emails
       SET status = 'sent', sent_at = NOW(), job_id = $2, updated_at = NOW()
       WHERE id = $1`,
      [emailId, `${messageId}|preview:${previewUrl}`]
    );

    console.log(`✅ Email sent successfully: ${emailId} | Preview: ${previewUrl}`);
  } catch (err) {
    if (err instanceof DelayedError) throw err;

    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`❌ Failed to send email ${emailId}:`, errorMessage);

    // Only mark as failed if no retries remain
    if ((job.attemptsMade + 1) >= (job.opts?.attempts ?? 1)) {
      await query(
        `UPDATE emails
         SET status = 'failed', error_message = $2, updated_at = NOW()
         WHERE id = $1`,
        [emailId, errorMessage]
      );
    }
    throw err;
  }
}

export function startEmailWorker() {
  const worker = new Worker('email-scheduler', processEmailJob, {
    connection: redisForBullMQ,
    concurrency: CONCURRENCY,
    limiter: {
      max: parseInt(process.env.MAX_EMAILS_PER_HOUR || '200'),
      duration: 3600000, // 1 hour in ms
    },
  });

  worker.on('completed', (job) => {
    console.log(`✅ Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    if (!(err instanceof DelayedError)) {
      console.error(`❌ Job ${job?.id} failed:`, err.message);
    }
  });

  worker.on('stalled', (jobId) => {
    console.warn(`⚠️ Job ${jobId} stalled`);
  });

  console.log(`🚀 Email worker started with concurrency: ${CONCURRENCY}, min delay: ${MIN_DELAY_MS}ms`);
  return worker;
}
