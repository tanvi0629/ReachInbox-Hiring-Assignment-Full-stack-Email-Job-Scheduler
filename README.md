# ReachInbox — Full-Stack Email Job Scheduler

A production-grade email scheduler service with a React dashboard. Built for the ReachInbox hiring assignment.

## 📐 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (Next.js 14)                                          │
│  • Google OAuth login → JWT stored in localStorage             │
│  • Dashboard: Schedule / Scheduled / Sent tabs                 │
│  • CSV upload → parse recipients → POST /emails/schedule       │
└────────────────────┬────────────────────────────────────────────┘
                     │ REST API (JWT Bearer)
┌────────────────────▼────────────────────────────────────────────┐
│  Backend (Express + TypeScript)                                 │
│                                                                 │
│  POST /emails/schedule ──► Insert to PostgreSQL               │
│                        ──► emailQueue.add(jobData, { delay })  │
│                                                                 │
│  BullMQ Worker (concurrency=5)                                  │
│  ┌────────────────────────────────────────────────┐            │
│  │ 1. Check idempotency (DB status = sent? skip)  │            │
│  │ 2. Check Redis rate limit (per-sender + global)│            │
│  │    → If exceeded: moveToDelayed(nextHour)      │            │
│  │    → Notify Slack if token exists              │            │
│  │ 3. sleep(MIN_DELAY_MS)  ← throttle             │            │
│  │ 4. Send via Ethereal SMTP                      │            │
│  │ 5. Increment Redis counters                    │            │
│  │ 6. UPDATE emails SET status='sent'             │            │
│  └────────────────────────────────────────────────┘            │
│                                                                 │
│  /admin/queues  ←  BullMQ live dashboard (Bull Board)         │
└──────────────┬───────────────────────────────────────────────-─┘
               │
       ┌───────┴──────────┐
       │  Redis 7          │  • BullMQ delayed job storage
       │                  │  • Rate limit counters (keyed by sender + hour)
       └──────────────────┘
       ┌──────────────────┐
       │  PostgreSQL 16    │  • users, emails tables
       │                  │  • 5 indexes (user_id, status, scheduled_at…)
       └──────────────────┘
```

## 🚀 How to Run

### Prerequisites
- Node.js 20+
- Docker & Docker Compose (for Redis + PostgreSQL)
- Google Cloud project with OAuth 2.0 credentials

---

### 1. Start Infrastructure (Redis + PostgreSQL)

```bash
cd reachinbox-scheduler/backend
docker-compose up -d
```

Verify with:
```bash
docker ps  # should show reachinbox_postgres + reachinbox_redis
```

---

### 2. Backend Setup

```bash
cd reachinbox-scheduler/backend
cp .env.example .env
```

Fill in `.env`:
```env
PORT=3001
NODE_ENV=development
JWT_SECRET=change-me-to-a-long-random-string

DATABASE_URL=postgresql://postgres:password@localhost:5432/reachinbox

REDIS_HOST=localhost
REDIS_PORT=6379

GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/callback

FRONTEND_URL=http://localhost:3000

MAX_EMAILS_PER_HOUR=200
MAX_EMAILS_PER_HOUR_PER_SENDER=50
WORKER_CONCURRENCY=5
MIN_DELAY_BETWEEN_SENDS_MS=2000

SLACK_CLIENT_ID=<from api.slack.com/apps>
SLACK_CLIENT_SECRET=<from api.slack.com/apps>
SLACK_REDIRECT_URI=http://localhost:3001/slack/callback
```

Install and run:
```bash
npm install
npm run db:migrate   # creates tables + indexes
npm run dev          # starts Express + BullMQ worker
```

The server starts at **http://localhost:3001**  
BullMQ live dashboard: **http://localhost:3001/admin/queues**

---

### 3. Frontend Setup

```bash
cd reachinbox-scheduler/frontend
cp .env.local.example .env.local
# .env.local contains: NEXT_PUBLIC_API_URL=http://localhost:3001

npm install
npm run dev
```

Frontend starts at **http://localhost:3000**

---

### 4. Ethereal Email Setup

Ethereal Email is a fake SMTP service for testing — **no setup required**.

The backend calls `nodemailer.createTestAccount()` on every email send, which automatically creates a fresh Ethereal account and returns a `previewUrl`. You can see the rendered email by visiting that URL.

The preview URL is logged in the backend console:
```
📧 Email sent: <abc123@ethereal.email> | Preview: https://ethereal.email/message/...
```

---

## 🔑 Google OAuth Configuration

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Add Authorized redirect URI: `http://localhost:3001/auth/google/callback`
4. Copy Client ID and Secret to `.env`

---

## ⚙️ Architecture Deep-Dive

### How Scheduling Works

1. **API call**: `POST /emails/schedule` accepts `{ senderEmail, senderName, recipients[], subject, body, scheduledAt, delayBetweenEmails, hourlyLimit }`
2. **Per-recipient staggering**: Each recipient gets a separate job with an offset of `i × delayBetweenEmails` ms from `scheduledAt`
3. **BullMQ delayed job**: Each job is added with `delay = scheduledAt + offset - now()` — no cron anywhere
4. **Idempotent job IDs**: Each job has `jobId: email:<uuid>`, preventing duplicate enqueuing even after retries

### How Persistence on Restart is Handled

- **Redis persistence**: Redis is started with `--appendonly yes` (AOF mode) in docker-compose, so job data survives restarts
- **BullMQ state**: Delayed jobs live in a Redis sorted set by timestamp. When the worker reconnects after a restart, it picks up exactly where it left off
- **DB source of truth**: `emails` table stores the full state. If a job somehow goes missing, the DB can be queried to reschedule
- **Idempotency check**: The worker's first step is `SELECT status FROM emails WHERE id = $1` — if `status = 'sent'`, it skips silently

### How Rate Limiting & Concurrency are Implemented

#### Worker Concurrency
```env
WORKER_CONCURRENCY=5  # configurable via env
```
BullMQ worker processes up to 5 jobs in parallel. Each job runs the full send pipeline independently.

#### Min Delay Between Sends
```env
MIN_DELAY_BETWEEN_SENDS_MS=2000  # default 2 seconds
```
Each worker call executes `await sleep(MIN_DELAY_MS)` before sending. This mimics provider throttling without needing `agenda`/`cron`. Chosen value: **2 seconds** — conservative enough for Ethereal, can be reduced for production SMTP.

#### Emails Per Hour (Rate Limiting)

Two layers:

**Layer 1 — BullMQ native limiter** (queue-wide):
```typescript
limiter: {
  max: MAX_EMAILS_PER_HOUR,   // e.g. 200
  duration: 3600000,           // 1 hour in ms
}
```

**Layer 2 — Redis-backed per-sender counter** (multi-instance safe):
```
Redis key: rate_limit:<senderEmail>:<hourWindow>
Redis key: rate_limit:global:<hourWindow>
TTL: 3600s (auto-expires at hour rollover)
```

When a worker picks up a job:
1. It reads both counters atomically via Redis pipeline
2. If either limit is exceeded → `job.moveToDelayed(nextHourStart)` → DB status set to `'delayed'`
3. Slack notification sent to the user (if connected)
4. If allowed → send email → `INCR` both counters → DB status `'sent'`

This approach is safe across multiple worker instances because all counters live in Redis (not in-memory).

#### When 1000+ Emails Are Scheduled at the Same Time

- Jobs are inserted into the BullMQ delayed set with per-email offsets
- The BullMQ limiter ensures no more than `MAX_EMAILS_PER_HOUR` are processed per hour
- Overflow jobs are automatically moved to the next hour window
- No jobs are dropped or lost — they are rescheduled preserving order

---

## 📦 Features Implemented

### Backend
| Feature | Status |
|---|---|
| Email scheduling via API | ✅ |
| BullMQ delayed jobs (no cron) | ✅ |
| PostgreSQL persistence (users + emails) | ✅ |
| Ethereal SMTP sending | ✅ |
| Idempotency (no duplicate sends) | ✅ |
| Configurable worker concurrency | ✅ |
| Min delay between sends (2s default) | ✅ |
| Redis-backed hourly rate limiting (global) | ✅ |
| Redis-backed hourly rate limiting (per-sender) | ✅ |
| Rate-limit overflow → reschedule next hour | ✅ |
| Slack OAuth connect/disconnect | ✅ |
| Slack notification on rate limit hit | ✅ |
| BullMQ live dashboard (`/admin/queues`) | ✅ |
| Server restart resilience (AOF Redis) | ✅ |
| CSV upload + email parsing | ✅ |
| Pagination + search on emails API | ✅ |
| Email cancellation | ✅ |

### Frontend
| Feature | Status |
|---|---|
| Real Google OAuth login | ✅ |
| JWT token stored + auto-refreshed | ✅ |
| User name, email, avatar in header | ✅ |
| Logout | ✅ |
| Stats cards (scheduled/sent/failed/delayed) | ✅ |
| Scheduled emails table with search + pagination | ✅ |
| Sent emails table with search + pagination | ✅ |
| Compose modal with CSV drag-and-drop | ✅ |
| Manual email entry | ✅ |
| Loading states | ✅ |
| Empty states | ✅ |
| Toast notifications (success/error) | ✅ |
| Slack connect/disconnect button | ✅ |
| Link to BullMQ live dashboard | ✅ |
| TypeScript types for all API responses | ✅ |
| Reusable UI components (Button, Badge, EmptyState…) | ✅ |

---

## ⚠️ Assumptions & Trade-offs

1. **Ethereal vs real SMTP**: Ethereal creates a fresh test account per send call. In production, you'd cache the transporter per sender account.

2. **Per-sender delay is implemented as scheduling offset**: Recipients in the same batch are staggered at the scheduling stage (each gets `scheduledAt + i * delay`), not by making the worker wait. This is more scalable.

3. **Slack channel**: The Slack OAuth flow stores `incoming_webhook.channel_id`. If the user's Slack app doesn't have incoming webhooks, fall back to `#general`. In production you'd let the user pick.

4. **Elasticsearch**: The assignment mentioned Elasticsearch for search; the current implementation uses PostgreSQL `ILIKE` for simplicity and correctness. Full-text indexing via `pg_trgm` or Elasticsearch can be added as a layer on top of the same DB writes.

5. **Multi-instance safety**: Rate limiting uses Redis pipelines (atomic reads), which is safe for horizontal scaling. BullMQ's own limiter adds a second layer of protection at the queue level.

6. **JWT expiry**: Tokens expire in 7 days. In production, use refresh tokens.

---

## 📁 Project Structure

```
reachinbox-scheduler/
├── backend/
│   ├── src/
│   │   ├── config/        # Redis + BullMQ queue setup
│   │   ├── db/            # PostgreSQL pool + migration
│   │   ├── middleware/    # JWT auth middleware
│   │   ├── routes/        # auth, emails, slack
│   │   ├── services/      # emailService (SMTP + rate limit + Slack)
│   │   ├── types/         # shared TypeScript types
│   │   ├── workers/       # BullMQ email worker
│   │   └── index.ts       # Express app entry point
│   ├── docker-compose.yml # PostgreSQL + Redis
│   ├── .env.example
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── app/           # Next.js App Router pages
    │   ├── components/    # Header, tables, compose modal, UI atoms
    │   ├── lib/           # API client, auth helpers, utils
    │   └── types/         # TypeScript interfaces
    ├── .env.local.example
    └── package.json
```
