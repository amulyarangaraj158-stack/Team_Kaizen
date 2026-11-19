import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bell, CheckCheck } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { cn, EmptyState } from '../components/ui/Primitives';

export function NotificationsPage() {
  const navigate = useNavigate();
  const {
    notifications,
    unreadCount,
    fetchNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    setActiveProjectId,
  } = useAppStore();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const visible = filter === 'unread' ? notifications.filter((n) => !n.isRead) : notifications;

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#F1F5F9]">Notifications</h1>
          <p className="mt-1 text-sm text-[#94A3B8]">
            Database-backed real-time alerts streamed over Socket.IO when backend scans, patches, tests, or rollbacks complete.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-md border border-[#00F5FF]/20 bg-[#0B1220] p-1">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={cn(
                'rounded px-3 py-1.5 text-xs font-semibold',
                filter === 'all' ? 'bg-[#142238] text-[#00F5FF]' : 'text-[#94A3B8]'
              )}
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('unread')}
              className={cn(
                'rounded px-3 py-1.5 text-xs font-semibold',
                filter === 'unread' ? 'bg-[#142238] text-[#00F5FF]' : 'text-[#94A3B8]'
              )}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllNotificationsRead()}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#00F5FF]/30 bg-[#142238] px-3.5 py-2 text-xs font-semibold text-[#00F5FF] hover:bg-[#192b47]"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark All Read
            </button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-5 w-5" />}
          title={filter === 'unread' ? 'All caught up' : 'No notifications yet'}
          description="Confirmed backend operations (scans, critical bugs, suggested patches, test runs, rollbacks) appear here automatically."
        />
      ) : (
        <div className="space-y-3">
          {visible.map((n) => (
            <div
              key={n.id}
              className={cn(
                'cyber-panel flex flex-col justify-between gap-3 rounded-lg p-4 sm:flex-row sm:items-center',
                !n.isRead && 'border-[#00F5FF]/40 bg-[#142238]/70'
              )}
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono text-[#00F5FF]">{n.type.replace(/_/g, ' ')}</span>
                  <span aria-hidden="true" className="text-[#94A3B8]">·</span>
                  <span className="font-mono text-[#94A3B8] tabular-nums">
                    {new Date(n.createdAt).toLocaleString()}
                  </span>
                  {!n.isRead && <span className="font-mono font-semibold text-[#39FF88]">· Unread</span>}
                </div>
                <h2 className="text-sm font-semibold text-[#F1F5F9]">{n.title}</h2>
                <p className="text-xs text-[#94A3B8]">{n.message}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {!n.isRead && (
                  <button
                    type="button"
                    onClick={() => markNotificationRead(n.id)}
                    className="rounded-md border border-slate-700 bg-[#0B1220] px-3 py-1.5 text-xs font-medium text-[#F1F5F9] hover:border-[#00F5FF]/40"
                  >
                    Mark Read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (!n.isRead) markNotificationRead(n.id);
                    if (n.projectId) setActiveProjectId(n.projectId);
                    navigate(n.linkPath || '/');
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-[#00F5FF] px-3 py-1.5 text-xs font-semibold text-[#070B14] hover:bg-[#33f7ff]"
                >
                  Open
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
