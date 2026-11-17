import React from 'react';
import {
  Bell,
  CheckCheck,
  Heart,
  MessageCircle,
  Phone,
  Radio,
  UserPlus,
} from 'lucide-react';
import { t } from '../lib/i18n';
import {
  formatRelativeTime,
  markAllNotificationsRead,
  markNotificationRead,
} from '../lib/socialApi';
import { LanguageCode, NotificationItem } from '../types/social';
import { Avatar } from './Avatar';

interface NotificationsViewProps {
  notifications: NotificationItem[];
  lang: LanguageCode;
  onNavigateFromNotification: (item: NotificationItem) => void;
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  notifications,
  lang,
  onNavigateFromNotification,
}) => {
  const unreadCount = notifications.filter((n) => !n.read).length;

  const getIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'like':
        return <Heart className="w-4 h-4 text-rose-500" />;
      case 'comment':
      case 'message':
        return <MessageCircle className="w-4 h-4 text-[#0D6E6E] dark:text-teal-400" />;
      case 'live':
        return <Radio className="w-4 h-4 text-amber-500" />;
      case 'call':
        return <Phone className="w-4 h-4 text-[#0D6E6E] dark:text-teal-400" />;
      case 'follow':
      case 'friend_request':
      case 'friend_accept':
        return <UserPlus className="w-4 h-4 text-[#0D6E6E] dark:text-teal-400" />;
      default:
        return <Bell className="w-4 h-4 text-zinc-500" />;
    }
  };

  return (
    <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden">
      <div className="px-6 py-4 border-b border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">{t(lang, 'notifications')}</h2>
          <p className="text-xs text-zinc-500 tabular-nums">{unreadCount} unread updates</p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => markAllNotificationsRead(notifications)}
            className="h-9 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold flex items-center gap-1.5 hover:border-[#0D6E6E] cursor-pointer"
          >
            <CheckCheck className="w-4 h-4 text-[#0D6E6E] dark:text-teal-400" />
            <span>{t(lang, 'markAllRead')}</span>
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="p-12 text-center text-sm text-zinc-500">
          You are all caught up. Likes, comments, friend requests, messages, and live alerts appear here in real time.
        </div>
      ) : (
        <div className="divide-y divide-[#E4DFD5]/70 dark:divide-[#262C30]/70">
          {notifications.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={async () => {
                if (!item.read) await markNotificationRead(item.id);
                onNavigateFromNotification(item);
              }}
              className={`w-full px-6 py-4 flex items-center gap-3.5 text-left transition-colors cursor-pointer ${
                !item.read ? 'bg-[#0D6E6E]/5 dark:bg-teal-500/10' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/30'
              }`}
            >
              <Avatar src={item.actorPhoto} name={item.actorName} size="md" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-900 dark:text-zinc-100">{item.message}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{formatRelativeTime(item.createdAt)}</p>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                {getIcon(item.type)}
                {!item.read && (
                  <span className="text-[11px] font-bold text-[#0D6E6E] dark:text-teal-400">New</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
