'use client';
import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { emailsAPI } from '@/lib/api';
import { Button } from './ui/Button';
import { X, Upload, Users } from 'lucide-react';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

/** Format a Date as a local datetime-local string (YYYY-MM-DDTHH:MM) */
function toLocalDatetimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Convert a datetime-local string (assumed local time) to an ISO string with timezone offset */
function localDatetimeToISO(localStr: string): string {
  const date = new Date(localStr);
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  return `${localStr}:00${sign}${pad(Math.floor(off / 60))}:${pad(off % 60)}`;
}

export default function ComposeModal({ onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [csvEmails, setCsvEmails] = useState<string[]>([]);
  const [manualEmails, setManualEmails] = useState('');
  const [form, setForm] = useState({
    senderEmail: '',
    senderName: '',
    subject: '',
    body: '',
    scheduledAt: '',
    delayBetweenEmails: 2000,
    hourlyLimit: 50,
  });

  const onDrop = useCallback((files: File[]) => {
    const file = files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const emails = text.split(/[\r\n,;]+/)
        .map(e => e.trim().replace(/^["']|["']$/g, ''))
        .filter(e => e.includes('@') && e.includes('.'));
      setCsvEmails(emails);
      toast.success(`Found ${emails.length} email addresses`);
    };
    reader.readAsText(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'text/plain': ['.txt'] },
    maxFiles: 1,
  });

  const allRecipients = [
    ...csvEmails,
    ...manualEmails.split(/[\r\n,;]+/).map(e => e.trim()).filter(e => e.includes('@')),
  ].filter((v, i, a) => a.indexOf(v) === i);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allRecipients.length) {
      toast.error('Please add at least one recipient');
      return;
    }
    setLoading(true);
    try {
      await emailsAPI.scheduleJson({
        ...form,
        // Send ISO string with timezone offset so the backend parses correctly
        scheduledAt: localDatetimeToISO(form.scheduledAt),
        recipients: allRecipients,
      });
      toast.success(`${allRecipients.length} email(s) scheduled!`);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to schedule emails';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const [minDatetime] = useState(() => toLocalDatetimeString(new Date(Date.now() + 60000)));

  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white';
  const labelClass = 'block text-sm font-medium text-gray-700 mb-1';

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-lg font-semibold text-gray-900">Compose New Email</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Sender Name *</label>
              <input className={inputClass} placeholder="John Doe" value={form.senderName}
                onChange={e => setForm(f => ({ ...f, senderName: e.target.value }))} required />
            </div>
            <div>
              <label className={labelClass}>Sender Email *</label>
              <input className={inputClass} type="email" placeholder="you@company.com" value={form.senderEmail}
                onChange={e => setForm(f => ({ ...f, senderEmail: e.target.value }))} required />
            </div>
          </div>

          <div>
            <label className={labelClass}>Subject *</label>
            <input className={inputClass} placeholder="Your email subject..." value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} required />
          </div>

          <div>
            <label className={labelClass}>Email Body *</label>
            <textarea className={inputClass + ' resize-none'} rows={5} placeholder="Write your email body here..."
              value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} required />
          </div>

          <div>
            <label className={labelClass}>Recipients</label>
            <div {...getRootProps()} className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${isDragActive ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'}`}>
              <input {...getInputProps()} />
              <Upload className="w-5 h-5 text-gray-400 mx-auto mb-1" />
              <p className="text-sm text-gray-500">Drop CSV/TXT file here or click to upload</p>
            </div>
            {csvEmails.length > 0 && (
              <div className="mt-2 flex items-center gap-2 text-sm text-indigo-600">
                <Users className="w-4 h-4" />
                {csvEmails.length} emails loaded from file
              </div>
            )}
            <div className="mt-2">
              <textarea className={inputClass + ' resize-none'} rows={3}
                placeholder="Or type emails manually, one per line or comma-separated"
                value={manualEmails} onChange={e => setManualEmails(e.target.value)} />
            </div>
            {allRecipients.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">Total: {allRecipients.length} unique recipients</p>
            )}
          </div>

          <div>
            <label className={labelClass}>Scheduled At *</label>
            <input className={inputClass} type="datetime-local" value={form.scheduledAt}
              min={minDatetime}
              onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Delay Between Emails (ms)</label>
              <input className={inputClass} type="number" min="500" step="500"
                value={form.delayBetweenEmails}
                onChange={e => setForm(f => ({ ...f, delayBetweenEmails: parseInt(e.target.value) || 2000 }))} />
              <p className="text-xs text-gray-400 mt-1">Min 2s recommended</p>
            </div>
            <div>
              <label className={labelClass}>Hourly Limit</label>
              <input className={inputClass} type="number" min="1" max="200"
                value={form.hourlyLimit}
                onChange={e => setForm(f => ({ ...f, hourlyLimit: parseInt(e.target.value) || 50 }))} />
              <p className="text-xs text-gray-400 mt-1">Max per hour</p>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" loading={loading} className="flex-1">
              Schedule {allRecipients.length > 0 ? `(${allRecipients.length})` : ''}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
