import nodemailer, { Transporter } from 'nodemailer';
import { redis } from '../config/redis';
import { query } from '../db/pool';
import axios from 'axios';

interface SendEmailOptions {
  senderEmail: string;
  senderName: string;
  recipientEmail: string;
  subject: string;
  body: string;
  emailId: string;
  userId: string;
}

// Cache transporter promise to avoid concurrent initialization races
let transporterPromise: Promise<Transporter> | null = null;

async function createTransporter(): Promise<Transporter> {
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.replace(/\s+/g, '');

  if (smtpUser && smtpPass) {
    const host = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465;
    console.log(`📨 Using real SMTP transporter (${host}:${port}, user: ${smtpUser})`);
    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user: smtpUser, pass: smtpPass },
    });
  }

  console.log('🧪 SMTP_USER/SMTP_PASS not set — falling back to Ethereal test SMTP');
  const testAccount = await nodemailer.createTestAccount();
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
}

async function getTransporter(): Promise<Transporter> {
  if (!transporterPromise) {
    transporterPromise = createTransporter().catch((err) => {
      transporterPromise = null;
      throw err;
    });
  }
  return transporterPromise;
}

// Rate limit key: sender + hour window
function getRateLimitKey(senderEmail: string): string {
  const hourWindow = Math.floor(Date.now() / (1000 * 60 * 60));
  return `rate_limit:${senderEmail}:${hourWindow}`;
}

// Global rate limit key
function getGlobalRateLimitKey(): string {
  const hourWindow = Math.floor(Date.now() / (1000 * 60 * 60));
  return `rate_limit:global:${hourWindow}`;
}

export async function checkRateLimit(senderEmail: string, hourlyLimit?: number): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const maxPerSender = hourlyLimit ?? parseInt(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER || '50');
  const maxGlobal = parseInt(process.env.MAX_EMAILS_PER_HOUR || '200');

  const senderKey = getRateLimitKey(senderEmail);
  const globalKey = getGlobalRateLimitKey();

  const pipeline = redis.pipeline();
  pipeline.get(senderKey);
  pipeline.get(globalKey);
  const results = await pipeline.exec();

  const senderCount = parseInt((results?.[0]?.[1] as string) || '0');
  const globalCount = parseInt((results?.[1]?.[1] as string) || '0');

  if (senderCount >= maxPerSender || globalCount >= maxGlobal) {
    // Retry at start of next hour
    const nowMs = Date.now();
    const nextHourMs = (Math.floor(nowMs / (1000 * 60 * 60)) + 1) * (1000 * 60 * 60);
    return { allowed: false, retryAfterMs: nextHourMs - nowMs };
  }
  return { allowed: true, retryAfterMs: 0 };
}

export async function incrementRateLimit(senderEmail: string): Promise<void> {
  const senderKey = getRateLimitKey(senderEmail);
  const globalKey = getGlobalRateLimitKey();
  const ttl = 3600; // 1 hour

  const pipeline = redis.pipeline();
  pipeline.incr(senderKey);
  pipeline.expire(senderKey, ttl);
  pipeline.incr(globalKey);
  pipeline.expire(globalKey, ttl);
  await pipeline.exec();
}

export async function sendEmail(opts: SendEmailOptions): Promise<{ messageId: string; previewUrl: string }> {
  const transporter = await getTransporter();
  const smtpUser = process.env.SMTP_USER?.trim();
  const fromAddress = smtpUser || opts.senderEmail;

  const info = await transporter.sendMail({
    from: `"${opts.senderName}" <${fromAddress}>`,
    replyTo: smtpUser && opts.senderEmail !== smtpUser ? opts.senderEmail : undefined,
    to: opts.recipientEmail,
    subject: opts.subject,
    html: opts.body,
    text: opts.body.replace(/<[^>]*>/g, ''), // strip HTML for text part
  });

  const previewUrl = nodemailer.getTestMessageUrl(info) || '';
  if (previewUrl) {
    console.log(`📧 Email sent: ${info.messageId} | Preview: ${previewUrl}`);
  } else {
    console.log(`📧 Email sent via SMTP to ${opts.recipientEmail}: ${info.messageId}`);
  }

  return { messageId: info.messageId, previewUrl };
}

export async function notifySlackRateLimit(userId: string, senderEmail: string): Promise<void> {
  try {
    const result = await query(
      'SELECT slack_access_token, slack_channel_id FROM users WHERE id = $1',
      [userId]
    );
    const user = result.rows[0];
    if (!user?.slack_access_token) return; // Slack not connected

    const message = {
      channel: user.slack_channel_id || '#general',
      text: `⚠️ *ReachInbox Rate Limit Hit*\nSender *${senderEmail}* has reached the hourly email limit. Jobs have been rescheduled for the next hour.`,
    };

    await axios.post('https://slack.com/api/chat.postMessage', message, {
      headers: {
        Authorization: `Bearer ${user.slack_access_token}`,
        'Content-Type': 'application/json',
      },
    });
    console.log(`🔔 Slack notification sent for rate limit on ${senderEmail}`);
  } catch (err) {
    console.error('Failed to send Slack notification:', err);
  }
}
