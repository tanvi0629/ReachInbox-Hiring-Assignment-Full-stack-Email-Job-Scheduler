'use client';
import { useState, useEffect } from 'react';
import { emailsAPI } from '@/lib/api';
import { Email, EmailsResponse } from '@/types';
import { StatusBadge } from './ui/Badge';
import { Button } from './ui/Button';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { EmptyState } from './ui/EmptyState';
import { formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';
import { Clock, Search, Trash2 } from 'lucide-react';

interface Props {
  refreshTrigger: number;
}

export default function ScheduledEmailsTable({ refreshTrigger }: Props) {
  const [data, setData] = useState<EmailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    emailsAPI.getScheduled({ page: String(page), limit: '20', search })
      .then((res) => { if (active) setData(res.data); })
      .catch(() => { if (active) toast.error('Failed to load scheduled emails'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, search, refreshTrigger, localRefresh]);

  const handleCancel = async (email: Email) => {
    setCancellingId(email.id);
    try {
      await emailsAPI.cancel(email.id);
      toast.success('Email cancelled');
      setLoading(true);
      setLocalRefresh(r => r + 1);
    } catch {
      toast.error('Failed to cancel email');
    } finally {
      setCancellingId(null);
    }
  };

  const totalPages = data ? Math.ceil(data.total / 20) : 0;

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Search by email or subject..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : !data?.emails?.length ? (
        <EmptyState icon={Clock} title="No scheduled emails" description="You haven't scheduled any emails yet. Click 'Compose New Email' to get started." />
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Recipient</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Subject</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">From</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Scheduled At</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.emails.map(email => (
                    <tr key={email.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 text-gray-900 font-medium">{email.recipient_email}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate">{email.subject}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{email.sender_email}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(email.scheduled_at)}</td>
                      <td className="px-4 py-3"><StatusBadge status={email.status} /></td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={cancellingId === email.id}
                          onClick={() => handleCancel(email)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>{data.total} total emails</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <span className="px-3 py-1.5 text-gray-600">{page} / {totalPages}</span>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
