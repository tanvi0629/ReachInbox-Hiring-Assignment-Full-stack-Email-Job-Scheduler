'use client';
import { useState, useEffect, useCallback, useSyncExternalStore, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { getStoredToken, decodeToken } from '@/lib/auth';
import { emailsAPI, slackAPI } from '@/lib/api';
import Header from '@/components/Header';
import StatsCards from '@/components/StatsCards';
import ScheduledEmailsTable from '@/components/ScheduledEmailsTable';
import SentEmailsTable from '@/components/SentEmailsTable';
import ComposeModal from '@/components/ComposeModal';
import { Button } from '@/components/ui/Button';
import { Plus, ExternalLink } from 'lucide-react';

const emptySubscribe = () => () => {};

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useSyncExternalStore(emptySubscribe, getStoredToken, () => null);
  const user = useMemo(() => (token ? decodeToken(token) : null), [token]);

  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent'>('scheduled');
  const [showCompose, setShowCompose] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [slackConnected, setSlackConnected] = useState(
    () => searchParams.get('slack_connected') === 'true'
  );

  useEffect(() => {
    if (!user) {
      router.replace('/login');
    }
  }, [user, router]);

  // Handle Slack OAuth redirect result notification & URL cleanup
  useEffect(() => {
    const slackOk = searchParams.get('slack_connected');
    const slackErr = searchParams.get('slack_error');
    if (slackOk === 'true') {
      toast.success('Slack connected successfully!');
      const url = new URL(window.location.href);
      url.searchParams.delete('slack_connected');
      window.history.replaceState({}, '', url.toString());
    } else if (slackErr) {
      toast.error(`Slack connection failed: ${slackErr}`);
      const url = new URL(window.location.href);
      url.searchParams.delete('slack_error');
      window.history.replaceState({}, '', url.toString());
    }
  }, [searchParams]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await emailsAPI.getStats();
      setStats(res.data.stats);
    } catch { /* silently fail */ }
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    emailsAPI.getStats()
      .then((res) => { if (active) setStats(res.data.stats); })
      .catch(() => { /* silently fail */ });
    slackAPI.getStatus()
      .then((res) => { if (active) setSlackConnected(res.data.connected); })
      .catch(() => { /* silently fail */ });
    return () => { active = false; };
  }, [user, refreshTrigger]);

  // Auto-refresh stats every 30 seconds
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [user, fetchStats]);

  const handleRefresh = () => setRefreshTrigger(t => t + 1);

  const handleConnectSlack = async () => {
    if (slackConnected) {
      try {
        await slackAPI.disconnect();
        setSlackConnected(false);
        toast.success('Slack disconnected');
      } catch { toast.error('Failed to disconnect Slack'); }
    } else {
      try {
        const res = await slackAPI.getConnectUrl();
        window.open(res.data.authUrl, '_blank');
      } catch { toast.error('Failed to get Slack auth URL'); }
    }
  };

  if (!user) return null;

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} slackConnected={slackConnected} onConnectSlack={handleConnectSlack} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page title + actions */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Email Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">Manage your scheduled and sent email campaigns</p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={`${API_URL}/admin/queues`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Queue Dashboard
            </a>
            <Button onClick={() => setShowCompose(true)}>
              <Plus className="w-4 h-4" />
              Compose New Email
            </Button>
          </div>
        </div>

        {/* Stats */}
        <StatsCards stats={stats} />

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
          {(['scheduled', 'sent'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2 text-sm font-medium rounded-lg transition-all capitalize ${
                activeTab === tab
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'scheduled' ? 'Scheduled Emails' : 'Sent Emails'}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          {activeTab === 'scheduled' ? (
            <ScheduledEmailsTable refreshTrigger={refreshTrigger} />
          ) : (
            <SentEmailsTable refreshTrigger={refreshTrigger} />
          )}
        </div>
      </main>

      {showCompose && (
        <ComposeModal onClose={() => setShowCompose(false)} onSuccess={handleRefresh} />
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  );
}
