import { cn } from '@/lib/utils';

interface BadgeProps {
  status: 'scheduled' | 'sent' | 'failed' | 'delayed';
  className?: string;
}

const config = {
  scheduled: { label: 'Scheduled', className: 'bg-blue-100 text-blue-700' },
  sent: { label: 'Sent', className: 'bg-green-100 text-green-700' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
  delayed: { label: 'Delayed', className: 'bg-yellow-100 text-yellow-700' },
};

export function StatusBadge({ status, className }: BadgeProps) {
  const { label, className: statusClass } = config[status] || config.scheduled;
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', statusClass, className)}>
      {label}
    </span>
  );
}
