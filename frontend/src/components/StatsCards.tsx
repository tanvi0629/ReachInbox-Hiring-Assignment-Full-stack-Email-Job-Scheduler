'use client';
import { Clock, Send, XCircle, AlertTriangle } from 'lucide-react';

interface Props {
  stats: Record<string, number>;
}

export default function StatsCards({ stats }: Props) {
  const cards = [
    { label: 'Scheduled', value: stats.scheduled || 0, icon: Clock, color: 'blue' },
    { label: 'Sent', value: stats.sent || 0, icon: Send, color: 'green' },
    { label: 'Failed', value: stats.failed || 0, icon: XCircle, color: 'red' },
    { label: 'Delayed', value: stats.delayed || 0, icon: AlertTriangle, color: 'yellow' },
  ];

  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    yellow: 'bg-yellow-50 text-yellow-600',
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
      {cards.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="bg-white rounded-xl border border-gray-100 p-4">
          <div className={`inline-flex p-2 rounded-lg mb-3 ${colorMap[color]}`}>
            <Icon className="w-4 h-4" />
          </div>
          <p className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</p>
          <p className="text-sm text-gray-500">{label}</p>
        </div>
      ))}
    </div>
  );
}
