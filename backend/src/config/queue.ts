import { Queue } from 'bullmq';
import { redisForBullMQ } from './redis';

export const EMAIL_QUEUE_NAME = 'email-scheduler';

export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection: redisForBullMQ,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { age: 86400, count: 1000 }, // Keep completed jobs for 24h
    removeOnFail: { age: 604800, count: 5000 },    // Keep failed jobs for 7 days
  },
});

console.log('✅ BullMQ email queue initialized');
