// import { Pool } from 'pg';
// import dotenv from 'dotenv';
// dotenv.config();

// const connectionString = process.env.DATABASE_URL || '';
// const useSSL =
//   process.env.DB_SSL === 'true' ||
//   connectionString.includes('sslmode=require') ||
//   (process.env.NODE_ENV === 'production' && !connectionString.includes('localhost'));

// export const pool = new Pool({
//   connectionString,
//   ssl: useSSL ? { rejectUnauthorized: false } : undefined,
//   max: 20,
//   idleTimeoutMillis: 30000,
//   connectionTimeoutMillis: 10000,
// });

// pool.on('connect', () => console.log('✅ PostgreSQL connected'));
// pool.on('error', (err) => console.error('❌ PostgreSQL pool error:', err));

// export const query = (text: string, params?: unknown[]) => pool.query(text, params);

import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || '';

if (!connectionString) {
  throw new Error('DATABASE_URL is missing from backend/.env');
}

const useSSL =
  process.env.DB_SSL === 'true' ||
  connectionString.includes('sslmode=require') ||
  (process.env.NODE_ENV === 'production' &&
    !connectionString.includes('localhost') &&
    !connectionString.includes('127.0.0.1'));

export const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => console.log('✅ PostgreSQL connected'));

pool.on('error', (err) =>
  console.error('❌ PostgreSQL pool error:', err)
);

export const query = (text: string, params?: unknown[]) =>
  pool.query(text, params);
