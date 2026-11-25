import { Redis, RedisOptions } from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

function buildRedisConfig(): RedisOptions {
  const redisUrl = process.env.REDIS_URL?.trim();

  if (redisUrl) {
    const parsed = new URL(redisUrl);
    const useTls = parsed.protocol === 'rediss:' || process.env.REDIS_TLS === 'true';
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379', 10),
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      tls: useTls ? {} : undefined,
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
    };
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6381', 10),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
  };
}

const redisConfig = buildRedisConfig();

export const redis = new Redis(redisConfig);
export const redisForBullMQ = new Redis(redisConfig);
// redisSubscriber is kept for future pub/sub use — always attach error handler
export const redisSubscriber = new Redis(redisConfig);

redis.on('connect', () => console.log('✅ Redis connected'));
redis.on('error', (err) => console.error('❌ Redis error:', err));
redisForBullMQ.on('error', (err) => console.error('❌ Redis (BullMQ) error:', err));
redisSubscriber.on('error', (err) => console.error('❌ Redis (subscriber) error:', err));
