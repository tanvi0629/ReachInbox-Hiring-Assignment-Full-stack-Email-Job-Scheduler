export interface EmailJob {
  id: string;
  userId: string;
  senderEmail: string;
  senderName: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: Date;
  delayBetweenEmails?: number; // ms
  hourlyLimit?: number;
  batchId: string;
}

export interface EmailRecord {
  id: string;
  user_id: string;
  batch_id: string;
  sender_email: string;
  sender_name: string;
  recipient_email: string;
  subject: string;
  body: string;
  scheduled_at: Date;
  sent_at?: Date;
  status: 'scheduled' | 'sent' | 'failed' | 'delayed';
  job_id?: string;
  error_message?: string;
  created_at: Date;
  updated_at: Date;
}

export interface User {
  id: string;
  google_id: string;
  email: string;
  name: string;
  avatar?: string;
  slack_access_token?: string;
  slack_channel_id?: string;
  slack_team_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface ScheduleEmailRequest {
  senderEmail: string;
  senderName: string;
  recipients: string[];
  subject: string;
  body: string;
  scheduledAt: string; // ISO string
  delayBetweenEmails?: number; // ms, default 2000
  hourlyLimit?: number;
}

export interface JWTPayload {
  userId: string;
  email: string;
  name: string;
  avatar?: string;
}
