import express from 'express';
import cors from 'cors';
import passport from 'passport';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import dotenv from 'dotenv';
dotenv.config();

import { emailQueue } from './config/queue';
import { startEmailWorker } from './workers/emailWorker';
import authRouter from './routes/auth';
import emailsRouter from './routes/emails';
import slackRouter from './routes/slack';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());

// BullMQ Dashboard
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({
   queues: [
    new BullMQAdapter(emailQueue) as any,
  ],
  serverAdapter,
});
app.use('/admin/queues', serverAdapter.getRouter());

// Routes
app.use('/auth', authRouter);
app.use('/emails', emailsRouter);
app.use('/slack', slackRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start worker
startEmailWorker();

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 BullMQ Dashboard: http://localhost:${PORT}/admin/queues`);
});

export default app;
