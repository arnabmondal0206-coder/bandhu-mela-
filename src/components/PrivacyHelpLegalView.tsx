import React, { useEffect, useState } from 'react';
import { FileText, HelpCircle, LifeBuoy, Lock, Send, Shield, Unlock } from 'lucide-react';
import { t } from '../lib/i18n';
import {
  createSupportTicket,
  formatRelativeTime,
  subscribeMySupportTickets,
  unblockUser,
  updatePrivacySettings,
} from '../lib/socialApi';
import { LanguageCode, SupportTicket, UserProfile } from '../types/social';
import { Avatar } from './Avatar';

interface PrivacyHelpLegalViewProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  blockedByMe: Set<string>;
  lang: LanguageCode;
  onProfileUpdated: (next: UserProfile) => void;
  onToast: (msg: string) => void;
}

export const PrivacyHelpLegalView: React.FC<PrivacyHelpLegalViewProps> = ({
  currentUser,
  allUsers,
  blockedByMe,
  lang,
  onProfileUpdated,
  onToast,
}) => {
  const [section, setSection] = useState<'privacy' | 'help' | 'legal'>('privacy');
  const [profileVisibility, setProfileVisibility] = useState(currentUser.profileVisibility);
  const [messagePrivacy, setMessagePrivacy] = useState(currentUser.messagePrivacy);
  const [showOnlineStatus, setShowOnlineStatus] = useState(currentUser.showOnlineStatus);
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [category, setCategory] = useState('Account & Security');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sendingTicket, setSendingTicket] = useState(false);

  useEffect(() => {
    const unsub = subscribeMySupportTickets(currentUser.uid, setTickets);
    return () => unsub();
  }, [currentUser.uid]);

  const handleSavePrivacy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPrivacy(true);
    try {
      await updatePrivacySettings(currentUser.uid, {
        profileVisibility,
        messagePrivacy,
        showOnlineStatus,
      });
      onProfileUpdated({
        ...currentUser,
        profileVisibility,
        messagePrivacy,
        showOnlineStatus,
      });
      onToast('Privacy settings saved');
    } finally {
      setSavingPrivacy(false);
    }
  };

  const handleSubmitTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    setSendingTicket(true);
    try {
      await createSupportTicket({
        user: currentUser,
        category,
        subject,
        message,
      });
      setSubject('');
      setMessage('');
      onToast('Support request submitted to BANDHU MELA team');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to submit ticket');
    } finally {
      setSendingTicket(false);
    }
  };

  const blockedUsersList = allUsers.filter((u) => blockedByMe.has(u.uid));

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSection('privacy')}
          className={`h-10 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
            section === 'privacy'
              ? 'bg-[#0D6E6E] text-white'
              : 'bg-[#F7F5F0] dark:bg-[#0E1113] text-zinc-600 dark:text-zinc-400'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>Privacy &amp; Safety</span>
        </button>
        <button
          type="button"
          onClick={() => setSection('help')}
          className={`h-10 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
            section === 'help'
              ? 'bg-[#0D6E6E] text-white'
              : 'bg-[#F7F5F0] dark:bg-[#0E1113] text-zinc-600 dark:text-zinc-400'
          }`}
        >
          <LifeBuoy className="w-4 h-4" />
          <span>{t(lang, 'helpCenter')}</span>
        </button>
        <button
          type="button"
          onClick={() => setSection('legal')}
          className={`h-10 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
            section === 'legal'
              ? 'bg-[#0D6E6E] text-white'
              : 'bg-[#F7F5F0] dark:bg-[#0E1113] text-zinc-600 dark:text-zinc-400'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>{t(lang, 'legalCenter')}</span>
        </button>
      </div>

      {section === 'privacy' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleSavePrivacy}
            className="lg:col-span-7 bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-5"
          >
            <div className="flex items-center gap-2.5">
              <Lock className="w-5 h-5 text-[#0D6E6E] dark:text-teal-400" />
              <h2 className="font-display text-lg font-bold">Account Privacy Controls</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5">
                  Profile Visibility
                </label>
                <select
                  value={profileVisibility}
                  onChange={(e) => setProfileVisibility(e.target.value as 'public' | 'friends')}
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
                >
                  <option value="public">Public (All BANDHU MELA members)</option>
                  <option value="friends">Friends Only</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5">
                  Who Can Message Me
                </label>
                <select
                  value={messagePrivacy}
                  onChange={(e) => setMessagePrivacy(e.target.value as 'everyone' | 'friends')}
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
                >
                  <option value="everyone">Everyone</option>
                  <option value="friends">Friends Only</option>
                </select>
              </div>

              <label className="flex items-center justify-between p-4 rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] cursor-pointer">
                <div>
                  <p className="text-sm font-semibold">Show Online &amp; Last Seen Status</p>
                  <p className="text-xs text-zinc-500">Allow friends to see when you are active</p>
                </div>
                <input
                  type="checkbox"
                  checked={showOnlineStatus}
                  onChange={(e) => setShowOnlineStatus(e.target.checked)}
                  className="w-5 h-5 accent-[#0D6E6E]"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={savingPrivacy}
              className="h-11 px-6 rounded-xl bg-[#0D6E6E] text-white text-sm font-semibold hover:bg-[#095454] cursor-pointer disabled:opacity-60"
            >
              {savingPrivacy ? 'Saving...' : 'Save Privacy Preferences'}
            </button>
          </form>

          <div className="lg:col-span-5 bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-4">
            <h3 className="font-display text-base font-bold">
              Blocked Accounts ({blockedByMe.size})
            </h3>
            {blockedUsersList.length === 0 ? (
              <p className="text-sm text-zinc-500">
                You haven&apos;t blocked anyone. Blocked users cannot follow, message, or call you.
              </p>
            ) : (
              <div className="space-y-3">
                {blockedUsersList.map((u) => (
                  <div
                    key={u.uid}
                    className="p-3 rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar src={u.photoURL} name={u.displayName} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{u.displayName}</p>
                        <p className="text-xs text-zinc-500 truncate">@{u.username}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await unblockUser(currentUser.uid, u.uid);
                        onToast(`Unblocked @${u.username}`);
                      }}
                      className="h-9 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Unlock className="w-3.5 h-3.5" />
                      <span>Unblock</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {section === 'help' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-5">
            <div className="flex items-center gap-2.5">
              <HelpCircle className="w-5 h-5 text-[#0D6E6E] dark:text-teal-400" />
              <h2 className="font-display text-lg font-bold">Contact Customer Support</h2>
            </div>
            <form onSubmit={handleSubmitTicket} className="space-y-3.5">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
              >
                <option value="Account & Security">Account &amp; Security</option>
                <option value="Verified Badge Request">Verified Badge Request</option>
                <option value="Abuse or Safety Report">Abuse or Safety Report</option>
                <option value="Bug or Technical Issue">Bug or Technical Issue</option>
              </select>
              <input
                type="text"
                required
                maxLength={140}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief subject"
                className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
              />
              <textarea
                rows={4}
                required
                maxLength={1500}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe how BANDHU MELA support can assist you..."
                className="w-full p-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm resize-none"
              />
              <button
                type="submit"
                disabled={sendingTicket}
                className="h-11 px-5 rounded-xl bg-[#0D6E6E] text-white text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <Send className="w-4 h-4" />
                <span>{sendingTicket ? 'Sending...' : 'Submit Support Request'}</span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-6 bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-4">
            <h3 className="font-display text-base font-bold">My Support Tickets ({tickets.length})</h3>
            {tickets.length === 0 ? (
              <p className="text-sm text-zinc-500">No support requests submitted yet.</p>
            ) : (
              <div className="space-y-3 max-h-[420px] overflow-y-auto">
                {tickets.map((tkt) => (
                  <div key={tkt.id} className="p-4 rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[#0D6E6E] dark:text-teal-400">
                        {tkt.category} · {tkt.status.toUpperCase()}
                      </span>
                      <span className="text-zinc-500">{formatRelativeTime(tkt.createdAt)}</span>
                    </div>
                    <h4 className="font-semibold text-sm">{tkt.subject}</h4>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">{tkt.message}</p>
                    {tkt.adminReply && (
                      <div className="p-3 rounded-xl bg-[#F7F5F0] dark:bg-[#0E1113] text-xs">
                        <span className="font-semibold text-[#0D6E6E] dark:text-teal-400">Admin Reply: </span>
                        {tkt.adminReply}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {section === 'legal' && (
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 sm:p-8 space-y-6 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
          <div>
            <h2 className="font-display text-xl font-bold text-zinc-950 dark:text-white">
              BANDHU MELA Privacy Policy &amp; Terms of Service
            </h2>
            <p className="text-xs text-zinc-500 mt-1">Effective 2025 · Free-tier-first community social platform</p>
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold text-zinc-950 dark:text-white">1. Data Privacy &amp; Access Rules</h3>
            <p>
              Private identifiers (email address, mobile number, role) are stored in isolated owner-only subcollections. Friends and public visitors only view fields permitted by your privacy settings.
            </p>
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold text-zinc-950 dark:text-white">2. Account Portability &amp; Permanent Deletion</h3>
            <p>
              Members can export all personal records as JSON or permanently delete their account and authored posts/stories from Profile settings at any time.
            </p>
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold text-zinc-950 dark:text-white">3. Terms of Community Conduct</h3>
            <p>
              Automated spam bursts, excessive link flooding, harassment, impersonation, and unlawful media are strictly prohibited and subject to automated rate limiting and admin moderation.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
