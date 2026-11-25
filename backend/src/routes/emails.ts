
import { Router, Response } from 'express';
import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { emailQueue } from '../config/queue';
import { query, pool } from '../db/pool';
import { ScheduleEmailRequest } from '../types';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Schedule emails
router.post(
  '/schedule',
  authMiddleware,
  upload.single('csvFile'),
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.auth!.userId;
      let body: ScheduleEmailRequest;

      if (req.file) {
        body = {
          senderEmail: req.body.senderEmail,
          senderName: req.body.senderName,
          subject: req.body.subject,
          body: req.body.body,
          scheduledAt: req.body.scheduledAt,
          delayBetweenEmails: parseInt(req.body.delayBetweenEmails || '2000'),
          hourlyLimit: parseInt(req.body.hourlyLimit || '50'),
          recipients: [],
        };

        const csvContent = req.file.buffer.toString('utf-8');

        try {
          const records = parse(csvContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
          }) as Record<string, string>[];

          body.recipients = records
            .map(
              (r) =>
                r.email ||
                r.Email ||
                r.EMAIL ||
                Object.values(r)[0]
            )
            .filter((email): email is string => Boolean(email));
        } catch {
          body.recipients = csvContent
            .split(/\r?\n/)
            .map((email) => email.trim())
            .filter((email) => email.includes('@'));
        }
      } else {
        body = req.body as ScheduleEmailRequest;
      }

      const {
        senderEmail,
        senderName,
        recipients,
        subject,
        body: emailBody,
        scheduledAt,
        delayBetweenEmails = 2000,
        hourlyLimit,
      } = body;

      if (
        !senderEmail ||
        !senderName ||
        !recipients?.length ||
        !subject ||
        !emailBody ||
        !scheduledAt
      ) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }

      // Validate sender email format
      if (!EMAIL_REGEX.test(senderEmail)) {
        res.status(400).json({ error: 'Invalid sender email address' });
        return;
      }

      // Validate all recipient emails
      const invalidRecipients = recipients.filter((r) => !EMAIL_REGEX.test(r));
      if (invalidRecipients.length > 0) {
        res.status(400).json({ error: `Invalid recipient email(s): ${invalidRecipients.slice(0, 3).join(', ')}` });
        return;
      }

      const scheduledDate = new Date(scheduledAt);

      if (
        isNaN(scheduledDate.getTime()) ||
        scheduledDate < new Date()
      ) {
        res.status(400).json({
          error: 'scheduledAt must be a valid future date',
        });
        return;
      }

      // Clamp numeric fields to safe ranges
      const safeDelay = Math.min(60000, Math.max(500, delayBetweenEmails));
      const safeHourlyLimit = hourlyLimit
        ? Math.min(200, Math.max(1, hourlyLimit))
        : undefined;

      const batchId = uuidv4();
      const now = new Date();
      const emailRecords = [];

      // Transactional batch INSERT
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        for (let i = 0; i < recipients.length; i++) {
          const emailId = uuidv4();
          const individualDelay = i * safeDelay;

          const adjustedScheduledAt = new Date(
            scheduledDate.getTime() + individualDelay
          );

          await client.query(
            `INSERT INTO emails
            (id, user_id, batch_id, sender_email, sender_name,
             recipient_email, subject, body, scheduled_at, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'scheduled')`,
            [
              emailId,
              userId,
              batchId,
              senderEmail,
              senderName,
              recipients[i],
              subject,
              emailBody,
              adjustedScheduledAt,
            ]
          );

          emailRecords.push({
            emailId,
            recipient: recipients[i],
            scheduledAt: adjustedScheduledAt,
            delayMs: Math.max(0, adjustedScheduledAt.getTime() - now.getTime()),
          });
        }

        await client.query('COMMIT');
      } catch (insertErr) {
        await client.query('ROLLBACK');
        throw insertErr;
      } finally {
        client.release();
      }

      // Enqueue BullMQ jobs after DB commit (compensate DB rows if queue fails)
      try {
        for (const record of emailRecords) {
          await emailQueue.add(
            'send-email',
            {
              id: record.emailId,
              userId,
              batchId,
              senderEmail,
              senderName,
              recipientEmail: record.recipient,
              subject,
              body: emailBody,
              scheduledAt: record.scheduledAt,
              delayBetweenEmails: safeDelay,
              hourlyLimit: safeHourlyLimit,
            },
            {
              delay: record.delayMs,
              // BullMQ v5 rejects custom jobIds containing ':'
              jobId: `email-${record.emailId}`,
            }
          );
        }
      } catch (queueErr) {
        await query('DELETE FROM emails WHERE batch_id = $1', [batchId]).catch(() => {});
        throw queueErr;
      }

      res.json({
        success: true,
        batchId,
        count: recipients.length,
        emails: emailRecords,
        message: `${recipients.length} email(s) scheduled successfully`,
      });
    } catch (err) {
      console.error('Schedule error:', err);
      res.status(500).json({
        error: 'Failed to schedule emails',
      });
    }
  }
);

// Get scheduled emails
router.get(
  '/scheduled',
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const { page = '1', limit = '20', search = '' } = req.query;

      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
      const offset = (pageNum - 1) * limitNum;

      let queryText = `
        SELECT id, batch_id, sender_email, sender_name,
        recipient_email, subject, scheduled_at, status, created_at
        FROM emails
        WHERE user_id = $1 AND status IN ('scheduled', 'delayed')
      `;

      const params: unknown[] = [userId];

      if (search) {
        params.push(`%${search}%`);
        queryText += ` AND (recipient_email ILIKE $${params.length}
          OR subject ILIKE $${params.length})`;
      }

      queryText += ` ORDER BY scheduled_at ASC
        LIMIT $${params.length + 1}
        OFFSET $${params.length + 2}`;

      params.push(limitNum, offset);

      const result = await query(queryText, params);

      const countParams: unknown[] = [userId];
      let countQuery = `SELECT COUNT(*) FROM emails WHERE user_id = $1 AND status IN ('scheduled', 'delayed')`;
      if (search) {
        countParams.push(`%${search}%`);
        countQuery += ` AND (recipient_email ILIKE $${countParams.length} OR subject ILIKE $${countParams.length})`;
      }
      const countResult = await query(countQuery, countParams);

      res.json({
        emails: result.rows,
        total: parseInt(countResult.rows[0].count),
        page: pageNum,
        limit: limitNum,
      });
    } catch (err) {
      console.error('Get scheduled error:', err);
      res.status(500).json({
        error: 'Failed to fetch scheduled emails',
      });
    }
  }
);

// Get sent emails
router.get(
  '/sent',
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const { page = '1', limit = '20', search = '' } = req.query;

      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
      const offset = (pageNum - 1) * limitNum;

      let queryText = `
        SELECT id, batch_id, sender_email, sender_name,
        recipient_email, subject, sent_at, status,
        error_message, created_at
        FROM emails
        WHERE user_id = $1 AND status IN ('sent', 'failed')
      `;

      const params: unknown[] = [userId];

      if (search) {
        params.push(`%${search}%`);
        queryText += ` AND (recipient_email ILIKE $${params.length}
          OR subject ILIKE $${params.length})`;
      }

      queryText += ` ORDER BY sent_at DESC NULLS LAST,
        created_at DESC
        LIMIT $${params.length + 1}
        OFFSET $${params.length + 2}`;

      params.push(limitNum, offset);

      const result = await query(queryText, params);

      const countParams2: unknown[] = [userId];
      let countQuery2 = `SELECT COUNT(*) FROM emails WHERE user_id = $1 AND status IN ('sent', 'failed')`;
      if (search) {
        countParams2.push(`%${search}%`);
        countQuery2 += ` AND (recipient_email ILIKE $${countParams2.length} OR subject ILIKE $${countParams2.length})`;
      }
      const countResult = await query(countQuery2, countParams2);

      res.json({
        emails: result.rows,
        total: parseInt(countResult.rows[0].count),
        page: pageNum,
        limit: limitNum,
      });
    } catch (err) {
      console.error('Get sent error:', err);
      res.status(500).json({
        error: 'Failed to fetch sent emails',
      });
    }
  }
);

// Get all emails summary
router.get(
  '/stats',
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.auth!.userId;

      const result = await query(
        `SELECT status, COUNT(*) as count
         FROM emails
         WHERE user_id = $1
         GROUP BY status`,
        [userId]
      );

      const stats: Record<string, number> = {};

      for (const row of result.rows) {
        stats[row.status] = parseInt(row.count);
      }

      res.json({ stats });
    } catch (err) {
      console.error('Get stats error:', err);
      res.status(500).json({
        error: 'Failed to fetch stats',
      });
    }
  }
);

// Cancel a scheduled email
router.delete(
  '/:id',
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const { id } = req.params;

      // Validate UUID to prevent injection / bad DB queries
      if (!uuidValidate(id)) {
        res.status(400).json({ error: 'Invalid email ID' });
        return;
      }

      const result = await query(
        `UPDATE emails
         SET status = 'failed',
             error_message = 'Cancelled by user',
             updated_at = NOW()
         WHERE id = $1
           AND user_id = $2
           AND status IN ('scheduled', 'delayed')
         RETURNING id`,
        [id, userId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({
          error: 'Email not found or already processed',
        });
        return;
      }

      try {
        const job = await emailQueue.getJob(`email-${id}`);

        if (job) {
          await job.remove();
        }
      } catch {
        // Job may have already been processed
      }

      res.json({
        success: true,
        message: 'Email cancelled',
      });
    } catch (err) {
      console.error('Cancel email error:', err);
      res.status(500).json({
        error: 'Failed to cancel email',
      });
    }
  }
);

export default router;
