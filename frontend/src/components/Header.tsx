'use client';
import Image from 'next/image';
import { LogOut, Zap, Bell } from 'lucide-react';
import { User } from '@/types';
import { authAPI } from '@/lib/api';

interface Props {
  user: User;
  slackConnected: boolean;
  onConnectSlack: () => void;
}

export default function Header({ user, slackConnected, onConnectSlack }: Props) {
  return (
    <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-gray-900 text-lg">ReachInbox</span>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {/* Slack */}
            <button
              onClick={onConnectSlack}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                slackConnected
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              <Bell className="w-4 h-4" />
              {slackConnected ? 'Slack Connected' : 'Connect Slack'}
            </button>

            {/* User info */}
            <div className="flex items-center gap-3 pl-3 border-l border-gray-100">
              {user.avatar ? (
                <Image src={user.avatar} alt={user.name} width={32} height={32} className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold text-sm">
                  {user.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="hidden sm:block">
                <p className="text-sm font-medium text-gray-900">{user.name}</p>
                <p className="text-xs text-gray-500">{user.email}</p>
              </div>
              <button
                onClick={authAPI.logout}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
