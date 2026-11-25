import { Redis } from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6381'),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
};

export const redis = new Redis(redisConfig);
export const redisForBullMQ = new Redis(redisConfig);
// redisSubscriber is kept for future pub/sub use — always attach error handler
export const redisSubscriber = new Redis(redisConfig);

redis.on('connect', () => console.log('✅ Redis connected'));
redis.on('error', (err) => console.error('❌ Redis error:', err));
redisForBullMQ.on('error', (err) => console.error('❌ Redis (BullMQ) error:', err));
redisSubscriber.on('error', (err) => console.error('❌ Redis (subscriber) error:', err));
