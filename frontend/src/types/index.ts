export interface User {
  userId: string;
  email: string;
  name: string;
  avatar?: string;
}

export interface Email {
  id: string;
  batch_id: string;
  sender_email: string;
  sender_name: string;
  recipient_email: string;
  subject: string;
  scheduled_at?: string;
  sent_at?: string;
  status: 'scheduled' | 'sent' | 'failed' | 'delayed';
  error_message?: string;
  created_at: string;
}

export interface EmailsResponse {
  emails: Email[];
  total: number;
  page: number;
  limit: number;
}

export interface StatsResponse {
  stats: Record<string, number>;
}

export interface ScheduleFormData {
  senderEmail: string;
  senderName: string;
  subject: string;
  body: string;
  scheduledAt: string;
  delayBetweenEmails: number;
  hourlyLimit: number;
  recipients: string[];
}
