import React, { useEffect, useState } from 'react';
import {
  Activity,
  AudioLines,
  BadgeCheck,
  Ban,
  BarChart3,
  CheckCircle2,
  Coins,
  Crown,
  Database,
  Download,
  Eye,
  EyeOff,
  Flag,
  Gift,
  LifeBuoy,
  Lock,
  Megaphone,
  MicOff,
  PauseCircle,
  PhoneOff,
  PlayCircle,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  computeLevelSummary,
  DEFAULT_LEVEL_CONFIG,
  fetchUserSpeakingHistory,
  formatSpeakingDuration,
  saveLevelConfigAdmin,
} from '../lib/levelVipApi';
import {
  adjustUserWalletOwner,
  banAudioParticipant,
  endAudioRoom,
  fetchAllAudioRoomsAdmin,
  fetchAllCoinTopupRequestsOwner,
  fetchAllCoinTransactionsOwner,
  fetchAllWalletsOwner,
  fetchAuditLogsOwner,
  logAdminAction,
  subscribeAudioParticipants,
  subscribeCoinPackages,
  subscribeVirtualGifts,
  toggleParticipantMute,
} from '../lib/audioPartyApi';
import {
  AdminLookupResponse,
  adminDeletePost,
  adminReplySupportTicket,
  adminSetPostStatus,
  adminSetUserSuspended,
  adminSetUserVerified,
  adminUpdateReport,
  createAnnouncement,
  deleteAnnouncement,
  endLiveStream,
  exportFullBackupJson,
  fetchAdminRecords,
  fetchAllAnnouncementsAdmin,
  fetchAllPostsForAdmin,
  fetchAllSupportTicketsAdmin,
  fetchAllUsersForAdmin,
  formatRelativeTime,
  ownerCreateAdminOrModerator,
  ownerLookupUserForAdmin,
  ownerRemoveAdminOrModerator,
  ownerUpdateAdminStatusOrRole,
  restoreBackupJson,
  saveAppSettings,
  subscribeAdminReports,
  toggleAnnouncementActive,
} from '../lib/socialApi';
import {
  AdminRecord,
  Announcement,
  AppSettings,
  AudioRoom,
  AudioRoomParticipant,
  AuditLogEntry,
  CoinPackage,
  CoinTopupRequest,
  CoinTransaction,
  LevelConfig,
  LiveStream,
  ModerationReport,
  Post,
  SpeakingMonthHistory,
  SpeakingStats,
  SupportTicket,
  UserProfile,
  UserWallet,
  VirtualGift,
} from '../types/social';
import { Avatar } from './Avatar';
import { LevelBadge } from './LevelBadge';
import { OwnerCoinEconomyPanel } from './OwnerCoinEconomyPanel';
import { VerifiedBadge } from './VerifiedBadge';

interface OwnerAdminViewProps {
  currentUser: UserProfile;
  isOriginalOwner: boolean;
  hasAdminAccess?: boolean;
  ownerUid?: string | null;
  ownerBackendVerified?: boolean;
  liveStreams: LiveStream[];
  appSettings: AppSettings;
  levelConfig?: LevelConfig;
  speakingStatsMap?: Record<string, SpeakingStats>;
  onToast: (msg: string) => void;
}

type AdminSection =
  | 'analytics'
  | 'users'
  | 'levels'
  | 'audio'
  | 'economy'
  | 'posts'
  | 'reports'
  | 'live'
  | 'tickets'
  | 'announcements'
  | 'settings'
  | 'audit'
  | 'backup';

export const OwnerAdminView: React.FC<OwnerAdminViewProps> = ({
  currentUser,
  isOriginalOwner,
  hasAdminAccess = true,
  ownerUid,
  ownerBackendVerified = false,
  liveStreams,
  appSettings,
  levelConfig = DEFAULT_LEVEL_CONFIG,
  speakingStatsMap = {},
  onToast,
}) => {
  const canAccess = isOriginalOwner || hasAdminAccess;
  const [section, setSection] = useState<AdminSection>(isOriginalOwner ? 'analytics' : 'posts');

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [adminRecords, setAdminRecords] = useState<AdminRecord[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);

  const [audioRooms, setAudioRooms] = useState<AudioRoom[]>([]);
  const [inspectRoomId, setInspectRoomId] = useState<string | null>(null);
  const [inspectParticipants, setInspectParticipants] = useState<AudioRoomParticipant[]>([]);

  const [gifts, setGifts] = useState<VirtualGift[]>([]);
  const [coinPackages, setCoinPackages] = useState<CoinPackage[]>([]);
  const [wallets, setWallets] = useState<UserWallet[]>([]);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [topupRequests, setTopupRequests] = useState<CoinTopupRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  const [loading, setLoading] = useState(true);

  const [annTitle, setAnnTitle] = useState('');
  const [annMessage, setAnnMessage] = useState('');
  const [annPriority, setAnnPriority] = useState<'normal' | 'important'>('normal');

  const [settingsDraft, setSettingsDraft] = useState(appSettings);
  const [levelDraft, setLevelDraft] = useState<LevelConfig>(levelConfig);
  const [inspectHistoryUid, setInspectHistoryUid] = useState<string | null>(null);
  const [inspectedHistory, setInspectedHistory] = useState<SpeakingMonthHistory[]>([]);
  const [ticketReplies, setTicketReplies] = useState<Record<string, string>>({});
  const [backupBusy, setBackupBusy] = useState(false);

  // Admin & Moderator creation + confirmation modal state
  const [adminIdentifier, setAdminIdentifier] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<'admin' | 'moderator'>('moderator');
  const [newAdminNotes, setNewAdminNotes] = useState('');
  const [lookupResult, setLookupResult] = useState<AdminLookupResponse | null>(null);
  const [adminFormError, setAdminFormError] = useState<string | null>(null);
  const [lookingUpUser, setLookingUpUser] = useState(false);
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [pendingAdminConfirm, setPendingAdminConfirm] = useState<{
    action: 'suspend' | 'reactivate' | 'remove' | 'switch_role';
    uid: string;
    displayName: string;
    email?: string;
    currentRole: 'admin' | 'moderator';
    nextRole?: 'admin' | 'moderator';
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const actorRole: 'owner' | 'admin' | 'moderator' = isOriginalOwner ? 'owner' : 'admin';

  useEffect(() => {
    setSettingsDraft(appSettings);
  }, [appSettings]);

  useEffect(() => {
    setLevelDraft(levelConfig);
  }, [levelConfig]);

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [uList, pList, aList, tList, audioList] = await Promise.all([
        fetchAllUsersForAdmin(),
        fetchAllPostsForAdmin(),
        fetchAllAnnouncementsAdmin(),
        fetchAllSupportTicketsAdmin(),
        fetchAllAudioRoomsAdmin(),
      ]);
      setUsers(uList);
      setPosts(pList);
      setAnnouncements(aList);
      setTickets(tList);
      setAudioRooms(audioList);

      if (isOriginalOwner) {
        const [rList, wList, txList, topList, logsList] = await Promise.all([
          fetchAdminRecords(),
          fetchAllWalletsOwner(),
          fetchAllCoinTransactionsOwner(),
          fetchAllCoinTopupRequestsOwner(),
          fetchAuditLogsOwner(),
        ]);
        setAdminRecords(rList);
        setWallets(wList);
        setTransactions(txList);
        setTopupRequests(topList);
        setAuditLogs(logsList);
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Admin data load partial');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    void loadAdminData();
    const uReports = subscribeAdminReports(setReports);
    const uGifts = subscribeVirtualGifts(setGifts);
    const uPkgs = subscribeCoinPackages(setCoinPackages);
    return () => {
      uReports();
      uGifts();
      uPkgs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOriginalOwner, canAccess]);

  useEffect(() => {
    if (!inspectRoomId) {
      setInspectParticipants([]);
      return;
    }
    return subscribeAudioParticipants(inspectRoomId, setInspectParticipants);
  }, [inspectRoomId]);

  const adminMap = new Map<string, AdminRecord>(adminRecords.map((a) => [a.uid, a]));
  const openReports = reports.filter((r) => r.status === 'open').length;
  const openTickets = tickets.filter((t) => t.status !== 'resolved').length;
  const pendingTopups = topupRequests.filter((t) => t.status === 'pending').length;
  const verifiedCount = users.filter((u) => u.isVerified).length;
  const suspendedCount = users.filter((u) => u.isSuspended).length;
  const reelsCount = posts.filter((p) => p.mediaType === 'reel').length;
  const hiddenPostsCount = posts.filter((p) => p.status === 'hidden').length;
  const liveAudioRoomsCount = audioRooms.filter((r) => r.status === 'live').length;
  const totalBeansEarned = wallets.reduce((sum, w) => sum + (w.earnedBeans || 0), 0);
  const totalCoinsInWallets = wallets.reduce((sum, w) => sum + (w.coinsBalance || 0), 0);
  const totalPurchasedCoins = topupRequests
    .filter((t) => t.status === 'approved')
    .reduce((sum, t) => sum + (t.coins || 0), 0);

  const audit = (action: string, targetType: string, targetId: string, details: string) =>
    logAdminAction({ actor: currentUser, actorRole, action, targetType, targetId, details });

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOriginalOwner) return;
    await saveAppSettings(currentUser.uid, {
      maintenanceMode: settingsDraft.maintenanceMode,
      allowNewRegistrations: settingsDraft.allowNewRegistrations,
      allowLiveStreaming: settingsDraft.allowLiveStreaming,
      allowVideoReels: settingsDraft.allowVideoReels,
      allowAudioRooms: settingsDraft.allowAudioRooms ?? true,
      allowVirtualGifts: settingsDraft.allowVirtualGifts ?? true,
      allowCoinPurchases: settingsDraft.allowCoinPurchases ?? true,
      ownerUid: currentUser.uid,
      welcomeHeadline: settingsDraft.welcomeHeadline,
    });
    await audit('save_platform_settings', 'appSettings', 'platform', `maintenance=${settingsDraft.maintenanceMode}, audio=${settingsDraft.allowAudioRooms}, gifts=${settingsDraft.allowVirtualGifts}`);
    onToast('Super Admin platform settings saved');
    void loadAdminData();
  };

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annTitle.trim() || !annMessage.trim()) return;
    await createAnnouncement({
      author: currentUser,
      title: annTitle,
      message: annMessage,
      priority: annPriority,
    });
    await audit('create_announcement', 'announcement', 'new', annTitle);
    setAnnTitle('');
    setAnnMessage('');
    onToast('Announcement published platform-wide');
    void loadAdminData();
  };

  const handleExportBackup = async () => {
    setBackupBusy(true);
    try {
      const data = await exportFullBackupJson();
      const fullPayload = {
        ...data,
        audioRooms,
        wallets,
        coinTransactions: transactions,
        virtualGifts: gifts,
        coinPackages,
        auditLogs,
      };
      const blob = new Blob([JSON.stringify(fullPayload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bandhu-mela-super-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      await audit('export_database_backup', 'backup', 'full', `Exported ${users.length} users, ${posts.length} posts`);
      onToast('Full Database JSON backup downloaded');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isOriginalOwner) return;
    setBackupBusy(true);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const res = await restoreBackupJson(currentUser.uid, parsed);
      await audit('restore_database_backup', 'backup', 'restore', `Restored ${res.restoredItems} items`);
      onToast(`Restored ${res.restoredItems} records from backup`);
      void loadAdminData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Invalid backup JSON file');
    } finally {
      setBackupBusy(false);
    }
  };

  const ownerOnlyTabs: { id: AdminSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'analytics', label: 'Overview & Revenue', icon: BarChart3 },
    { id: 'users', label: `Users & Admins (${users.length})`, icon: Users },
    { id: 'levels', label: 'Levels & VIP', icon: Sparkles },
    { id: 'audio', label: `Audio Rooms (${liveAudioRoomsCount})`, icon: AudioLines },
    { id: 'economy', label: `Coin Economy (${pendingTopups})`, icon: Coins },
    { id: 'posts', label: `Posts (${posts.length})`, icon: ShieldAlert },
    { id: 'reports', label: `Reports (${openReports})`, icon: Flag },
    { id: 'live', label: `Live (${liveStreams.length})`, icon: Radio },
    { id: 'tickets', label: `Support (${openTickets})`, icon: LifeBuoy },
    { id: 'announcements', label: 'Announcements', icon: Megaphone },
    { id: 'settings', label: 'Platform Settings', icon: Settings },
    { id: 'audit', label: `Audit Log (${auditLogs.length})`, icon: Activity },
    { id: 'backup', label: 'Backup & Recovery', icon: Database },
  ];

  const moderatorTabs: { id: AdminSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'posts', label: `Posts (${posts.length})`, icon: ShieldAlert },
    { id: 'reports', label: `Reports (${openReports})`, icon: Flag },
    { id: 'levels', label: 'Levels & VIP', icon: Sparkles },
    { id: 'audio', label: `Audio Rooms (${liveAudioRoomsCount})`, icon: AudioLines },
    { id: 'live', label: `Live (${liveStreams.length})`, icon: Radio },
    { id: 'tickets', label: `Support (${openTickets})`, icon: LifeBuoy },
    { id: 'announcements', label: 'Announcements', icon: Megaphone },
  ];

  const visibleTabs = isOriginalOwner ? ownerOnlyTabs : moderatorTabs;
  const inspectedRoom = audioRooms.find((r) => r.id === inspectRoomId) || null;

  if (!canAccess) {
    return (
      <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-8 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-red-500/15 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="font-display text-lg font-bold">Access Restricted</h2>
        <p className="text-sm text-zinc-500 max-w-md mx-auto">
          The Super Admin Owner Control Panel is restricted to the verified BANDHU MELA platform owner and authorized moderators.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-xl font-bold">
                  {isOriginalOwner ? 'Super Admin Owner Control Panel' : 'BANDHU MELA Moderator Desk'}
                </h2>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[#0D6E6E] text-white">
                  {isOriginalOwner ? 'ORIGINAL OWNER' : 'MODERATOR'}
                </span>
              </div>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {isOriginalOwner
                    ? 'Full backend authority over admins, users, audio rooms, virtual gifts, coin economy, privacy settings, audit logs, and backups.'
                    : 'Authorized content moderation access. Super Admin Owner controls remain locked to the original platform owner.'}
                </p>
                {isOriginalOwner && (
                  <p className="text-[11px] font-mono text-[#0D6E6E] dark:text-teal-400 mt-1 flex items-center gap-1.5">
                    <Lock className="w-3 h-3 shrink-0" />
                    <span>
                      Verified Owner UID: {ownerUid || currentUser.uid} ·{' '}
                      {ownerBackendVerified ? 'Backend UID Locked' : 'Firestore Registry Locked'}
                    </span>
                  </p>
                )}
              </div>
            </div>
          <button
            type="button"
            onClick={() => loadAdminData()}
            className="h-10 px-4 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Live Data</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {visibleTabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`h-9 px-3.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                  section === item.id
                    ? 'bg-[#0D6E6E] text-white'
                    : 'bg-[#F7F5F0] dark:bg-[#0E1113] text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 1. ANALYTICS & REVENUE (OWNER ONLY) */}
      {section === 'analytics' && isOriginalOwner && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Accounts', value: users.length, note: `${verifiedCount} verified · ${suspendedCount} suspended` },
            { label: 'Posts & Reels', value: posts.length, note: `${reelsCount} reels · ${hiddenPostsCount} hidden` },
            { label: 'Live Audio & Video', value: liveAudioRoomsCount + liveStreams.length, note: `${liveAudioRoomsCount} audio rooms · ${liveStreams.length} streams` },
            { label: 'Approved Coin Sales', value: totalPurchasedCoins, note: `${pendingTopups} pending requests` },
            { label: 'Coins in Wallets', value: totalCoinsInWallets, note: `${wallets.length} active wallets` },
            { label: 'Host Reward Beans', value: totalBeansEarned, note: 'Earned by audio hosts & speakers' },
            { label: 'Open Reports', value: openReports, note: `${reports.length} total reports` },
            { label: 'Support Tickets', value: openTickets, note: `${tickets.length} total tickets` },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-1"
            >
              <p className="text-xs font-semibold text-zinc-500">{stat.label}</p>
              <p className="font-display text-3xl font-bold tabular-nums">{stat.value}</p>
              <p className="text-[11px] text-[#0D6E6E] dark:text-teal-400">{stat.note}</p>
            </div>
          ))}
        </div>
      )}

      {/* 2. USERS, ADMINS & MODERATORS (OWNER ONLY) */}
      {section === 'users' && isOriginalOwner && (
        <div className="space-y-6">
          {/* Permanently Protected Original Owner Banner */}
          <div className="bg-amber-500/10 border border-amber-400/50 rounded-3xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Crown className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold flex items-center gap-2">
                  <span>Original Owner Account · Permanently Protected</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-500 text-white">
                    IMMUTABLE
                  </span>
                </p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                  UID: <span className="font-mono">{ownerUid || appSettings.ownerUid || currentUser.uid}</span> · Only this verified Original Owner can create, suspend, reactivate, or remove Admins &amp; Moderators. Nobody can suspend, demote, or remove the Original Owner.
                </p>
              </div>
            </div>
            <span className="h-9 px-3.5 rounded-xl bg-amber-500/20 text-amber-800 dark:text-amber-300 text-xs font-bold flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              <span>{ownerBackendVerified ? 'Backend + Rules Locked' : 'Owner Registry Locked'}</span>
            </span>
          </div>

          {/* Create Admin or Moderator Form */}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!isOriginalOwner || creatingAdmin) return;
              const cleanId = adminIdentifier.trim();
              if (!cleanId) {
                const msg = 'Enter a registered user email address or Firebase UID first.';
                setAdminFormError(msg);
                onToast(msg);
                return;
              }
              if (lookupResult?.isProtectedOwner) {
                const msg =
                  'The Original Owner account is permanently protected and cannot be reassigned or demoted.';
                setAdminFormError(msg);
                onToast(msg);
                return;
              }
              setAdminFormError(null);
              setCreatingAdmin(true);
              try {
                const created = await ownerCreateAdminOrModerator({
                  identifier: cleanId,
                  role: newAdminRole,
                  notes: newAdminNotes,
                });
                onToast(
                  `Created ${created.role === 'admin' ? 'Admin' : 'Moderator'} account for ${
                    created.displayName || created.uid
                  }`
                );
                setAdminIdentifier('');
                setNewAdminNotes('');
                setLookupResult(null);
                await loadAdminData();
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Unable to create Admin or Moderator.';
                setAdminFormError(msg);
                onToast(msg);
              } finally {
                setCreatingAdmin(false);
              }
            }}
            className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-4"
          >
            {(() => {
              const handleFindUser = async () => {
                if (lookingUpUser) return;
                const clean = adminIdentifier.trim();
                if (!clean) {
                  const msg = 'Please enter a registered user email address or Firebase UID.';
                  setLookupResult(null);
                  setAdminFormError(msg);
                  onToast(msg);
                  return;
                }
                setAdminFormError(null);
                setLookupResult(null);
                setLookingUpUser(true);
                try {
                  const res = await ownerLookupUserForAdmin(clean);
                  setLookupResult(res);
                  onToast(`Matched user: ${res.user.displayName} (@${res.user.username || 'member'})`);
                } catch (err) {
                  const msg = err instanceof Error ? err.message : 'User lookup failed.';
                  setLookupResult(null);
                  setAdminFormError(msg);
                  onToast(msg);
                } finally {
                  setLookingUpUser(false);
                }
              };

              return (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-display text-base font-bold flex items-center gap-2">
                        <UserPlus className="w-4 h-4 text-[#0D6E6E]" />
                        <span>Create Admin or Moderator</span>
                      </h3>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Assign Admin or Moderator permissions to a real registered BANDHU MELA user by email or Firebase UID.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                    <div className="md:col-span-6 space-y-1.5">
                      <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                        Registered User Email or Firebase UID
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={adminIdentifier}
                          onChange={(e) => {
                            setAdminIdentifier(e.target.value);
                            setAdminFormError(null);
                            if (lookupResult) setLookupResult(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleFindUser();
                            }
                          }}
                          placeholder="user@example.com or Firebase UID"
                          className="flex-1 h-10 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0]/50 dark:bg-[#0E1113] text-sm"
                        />
                        <button
                          type="button"
                          disabled={lookingUpUser}
                          onClick={() => {
                            void handleFindUser();
                          }}
                          className="h-10 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs font-semibold flex items-center gap-1.5 hover:border-[#0D6E6E] disabled:opacity-60 cursor-pointer shrink-0"
                        >
                          {lookingUpUser ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#0D6E6E]" />
                          ) : (
                            <Search className="w-3.5 h-3.5 text-[#0D6E6E]" />
                          )}
                          <span>{lookingUpUser ? 'Searching...' : 'Find User'}</span>
                        </button>
                      </div>
                    </div>

                    <div className="md:col-span-3 space-y-1.5">
                      <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Role</label>
                      <select
                        value={newAdminRole}
                        onChange={(e) => setNewAdminRole(e.target.value === 'admin' ? 'admin' : 'moderator')}
                        className="w-full h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0]/50 dark:bg-[#0E1113] text-sm font-semibold"
                      >
                        <option value="moderator">Moderator (Content, Reports, Audio)</option>
                        <option value="admin">Admin (Full Moderation &amp; Support)</option>
                      </select>
                    </div>

                    <div className="md:col-span-3 space-y-1.5">
                      <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                        Optional Note
                      </label>
                      <input
                        type="text"
                        maxLength={300}
                        value={newAdminNotes}
                        onChange={(e) => setNewAdminNotes(e.target.value)}
                        placeholder="e.g. Audio room mod"
                        className="w-full h-10 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0]/50 dark:bg-[#0E1113] text-sm"
                      />
                    </div>
                  </div>

                  {lookingUpUser && (
                    <div className="rounded-2xl border border-[#0D6E6E]/30 bg-[#0D6E6E]/5 px-4 py-3 flex items-center gap-2.5 text-xs font-semibold text-[#0D6E6E] dark:text-teal-300">
                      <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                      <span>Searching registered BANDHU MELA accounts in Firestore...</span>
                    </div>
                  )}

                  {lookupResult && !lookingUpUser && (
                    <div className="rounded-2xl border border-[#0D6E6E]/40 bg-[#0D6E6E]/5 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar src={lookupResult.user.photoURL} name={lookupResult.user.displayName} size="sm" />
                          <div className="min-w-0">
                            <p className="text-sm font-bold flex items-center gap-1.5">
                              <span>{lookupResult.user.displayName}</span>
                              {lookupResult.user.isVerified && <VerifiedBadge className="w-4 h-4" />}
                            </p>
                            <p className="text-xs text-zinc-500">@{lookupResult.user.username || 'member'}</p>
                          </div>
                        </div>
                        {lookupResult.isProtectedOwner ? (
                          <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-amber-500 text-white flex items-center gap-1">
                            <Lock className="w-3 h-3" />
                            <span>Current Role: Original Owner (Protected)</span>
                          </span>
                        ) : lookupResult.existingAdmin ? (
                          <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300">
                            Current Role: {lookupResult.existingAdmin.role === 'admin' ? 'Admin' : 'Moderator'} (
                            {lookupResult.existingAdmin.isSuspended ? 'Suspended' : 'Active'})
                          </span>
                        ) : (
                          <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                            Current Role: User (Eligible)
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs pt-2 border-t border-[#0D6E6E]/20">
                        <div>
                          <span className="text-zinc-500 block text-[11px]">Name</span>
                          <span className="font-semibold">{lookupResult.user.displayName}</span>
                        </div>
                        <div>
                          <span className="text-zinc-500 block text-[11px]">Username</span>
                          <span className="font-semibold">@{lookupResult.user.username || 'member'}</span>
                        </div>
                        <div>
                          <span className="text-zinc-500 block text-[11px]">Email</span>
                          <span className="font-semibold break-all">
                            {lookupResult.user.email || 'Not stored in private profile'}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-500 block text-[11px]">Firebase UID</span>
                          <span className="font-mono text-[11px] break-all">{lookupResult.user.uid}</span>
                        </div>
                      </div>

                      {lookupResult.isProtectedOwner && (
                        <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                          The Original Owner account is permanently protected and cannot be modified, suspended, demoted, or removed.
                        </p>
                      )}
                    </div>
                  )}

                  {adminFormError && (
                    <div className="flex items-start gap-2 text-xs font-semibold text-red-700 dark:text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-3.5 py-2.5">
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{adminFormError}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[11px] text-zinc-500">
                      Enforced by backend authorization (`/api/owner/admins`) and Firestore security rules.
                    </p>
                    <button
                      type="submit"
                      disabled={creatingAdmin || !adminIdentifier.trim() || Boolean(lookupResult?.isProtectedOwner)}
                      className="h-10 px-5 rounded-xl bg-[#0D6E6E] hover:bg-[#095454] text-white text-xs font-bold flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>
                        {creatingAdmin
                          ? 'Creating...'
                          : `Create ${newAdminRole === 'admin' ? 'Admin' : 'Moderator'}`}
                      </span>
                    </button>
                  </div>
                </>
              );
            })()}
          </form>

          {/* Existing Admin & Moderator Team List */}
          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E4DFD5] dark:border-[#262C30] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-bold flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#0D6E6E]" />
                  <span>
                    Admin &amp; Moderator Accounts (
                    {
                      adminRecords.filter(
                        (a) =>
                          a.uid !== (ownerUid || appSettings.ownerUid || currentUser.uid) &&
                          a.uid !== currentUser.uid
                      ).length
                    }
                    )
                  </span>
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  All delegated Admins &amp; Moderators with live status and confirmation-protected controls.
                </p>
              </div>
            </div>

            {(() => {
              const protectedOwnerId = ownerUid || appSettings.ownerUid || currentUser.uid;
              const teamList = adminRecords.filter(
                (a) => a.uid && a.uid !== protectedOwnerId && a.uid !== currentUser.uid
              );
              if (teamList.length === 0) {
                return (
                  <div className="p-8 text-center text-xs text-zinc-500">
                    No delegated Admin or Moderator accounts yet. Use the form above to assign one to a registered user.
                  </div>
                );
              }
              return (
                <div className="divide-y divide-[#E4DFD5] dark:divide-[#262C30]">
                  {teamList.map((adm) => {
                    const userObj = users.find((u) => u.uid === adm.uid);
                    const displayName = userObj?.displayName || adm.displayName || 'Bandhu Member';
                    const roleLabel: 'admin' | 'moderator' =
                      adm.role === 'admin' ? 'admin' : 'moderator';
                    const isSuspended = Boolean(adm.isSuspended);
                    return (
                      <div
                        key={adm.uid}
                        className="p-4 flex flex-wrap items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar src={userObj?.photoURL || ''} name={displayName} size="sm" />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="text-sm font-bold truncate">{displayName}</p>
                              <span
                                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md ${
                                  roleLabel === 'admin'
                                    ? 'bg-[#0D6E6E] text-white'
                                    : 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
                                }`}
                              >
                                {roleLabel}
                              </span>
                              <span
                                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md flex items-center gap-1 ${
                                  isSuspended
                                    ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                                    : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                }`}
                              >
                                {isSuspended ? 'SUSPENDED' : 'ACTIVE'}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-500 truncate mt-0.5">
                              {userObj?.username ? `@${userObj.username} · ` : ''}
                              {adm.email ? `${adm.email} · ` : ''}
                              UID: <span className="font-mono">{adm.uid}</span>
                              {adm.notes ? ` · ${adm.notes}` : ''}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setPendingAdminConfirm({
                                action: 'switch_role',
                                uid: adm.uid,
                                displayName,
                                email: adm.email,
                                currentRole: roleLabel,
                                nextRole: roleLabel === 'admin' ? 'moderator' : 'admin',
                              })
                            }
                            className="h-9 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold hover:border-[#0D6E6E] cursor-pointer"
                          >
                            Switch to {roleLabel === 'admin' ? 'Moderator' : 'Admin'}
                          </button>

                          {isSuspended ? (
                            <button
                              type="button"
                              onClick={() =>
                                setPendingAdminConfirm({
                                  action: 'reactivate',
                                  uid: adm.uid,
                                  displayName,
                                  email: adm.email,
                                  currentRole: roleLabel,
                                })
                              }
                              className="h-9 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                            >
                              <PlayCircle className="w-3.5 h-3.5" />
                              <span>Reactivate</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setPendingAdminConfirm({
                                  action: 'suspend',
                                  uid: adm.uid,
                                  displayName,
                                  email: adm.email,
                                  currentRole: roleLabel,
                                })
                              }
                              className="h-9 px-3 rounded-xl border border-amber-400 text-amber-700 dark:text-amber-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-amber-500/10 cursor-pointer"
                            >
                              <PauseCircle className="w-3.5 h-3.5" />
                              <span>Suspend</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              setPendingAdminConfirm({
                                action: 'remove',
                                uid: adm.uid,
                                displayName,
                                email: adm.email,
                                currentRole: roleLabel,
                              })
                            }
                            className="h-9 px-3 rounded-xl border border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 text-xs font-semibold flex items-center gap-1.5 hover:bg-red-500/10 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* All Registered Users Directory */}
          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl divide-y divide-[#E4DFD5] dark:divide-[#262C30]">
            <div className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-zinc-500 flex items-center gap-2">
                <Users className="w-4 h-4 text-[#0D6E6E]" />
                <span>Registered Platform Accounts ({users.length})</span>
              </div>
              <input
                type="text"
                value={userSearchQuery}
                onChange={(e) => setUserSearchQuery(e.target.value)}
                placeholder="Filter by name, @username, or UID..."
                className="h-9 w-full sm:w-64 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0]/50 dark:bg-[#0E1113] text-xs"
              />
            </div>
            {users
              .filter((u) => {
                const q = userSearchQuery.trim().toLowerCase();
                if (!q) return true;
                return (
                  u.displayName.toLowerCase().includes(q) ||
                  u.username.toLowerCase().includes(q) ||
                  u.uid.toLowerCase().includes(q)
                );
              })
              .map((u) => {
                const adminRec = adminMap.get(u.uid);
                const protectedOwnerId = ownerUid || appSettings.ownerUid || currentUser.uid;
                const isTargetOwner = u.uid === protectedOwnerId || (isOriginalOwner && u.uid === currentUser.uid);
                return (
                  <div key={u.uid} className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar src={u.photoURL} name={u.displayName} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                          <span>{u.displayName}</span>
                          {u.isVerified && <VerifiedBadge className="w-4 h-4" />}
                          {isTargetOwner && (
                            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                              [Original Owner · Protected]
                            </span>
                          )}
                          {adminRec && !isTargetOwner && (
                            <span className="text-[11px] font-bold text-[#0D6E6E] dark:text-teal-400">
                              [{adminRec.role || 'admin'}{adminRec.isSuspended ? ' · Suspended' : ' · Active'}]
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-zinc-500">
                          @{u.username} · UID: <span className="font-mono">{u.uid}</span> · {u.postsCount} posts
                          {u.isSuspended && ' · ACCOUNT SUSPENDED'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {!isTargetOwner && (
                        <button
                          type="button"
                          onClick={async () => {
                            await adminSetUserVerified(u.uid, !u.isVerified);
                            await audit(u.isVerified ? 'unverify_user' : 'verify_user', 'user', u.uid, `@${u.username}`);
                            onToast(u.isVerified ? `Verified badge removed from @${u.username}` : `@${u.username} verified`);
                            void loadAdminData();
                          }}
                          className={`h-9 px-3 rounded-xl text-xs font-semibold flex items-center gap-1 cursor-pointer ${
                            u.isVerified
                              ? 'bg-[#0D6E6E] text-white'
                              : 'border border-[#E4DFD5] dark:border-[#262C30]'
                          }`}
                        >
                          <BadgeCheck className="w-3.5 h-3.5" />
                          <span>{u.isVerified ? 'Verified' : 'Verify'}</span>
                        </button>
                      )}

                      {isTargetOwner && (
                        <span className="h-9 px-3 rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300 text-xs font-bold flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5" />
                          <span>Immutable Owner</span>
                        </span>
                      )}

                      {!isTargetOwner && (
                        <>
                          <button
                            type="button"
                            onClick={async () => {
                              await adminSetUserSuspended(u.uid, !u.isSuspended);
                              await audit(u.isSuspended ? 'unsuspend_user' : 'suspend_user', 'user', u.uid, `@${u.username}`);
                              onToast(u.isSuspended ? `Restored @${u.username}` : `Suspended @${u.username}`);
                              void loadAdminData();
                            }}
                            className={`h-9 px-3 rounded-xl text-xs font-semibold cursor-pointer ${
                              u.isSuspended
                                ? 'bg-emerald-600 text-white'
                                : 'border border-red-300 dark:border-red-900 text-red-600'
                            }`}
                          >
                            {u.isSuspended ? 'Unsuspend User' : 'Suspend User'}
                          </button>

                          {!adminRec && (
                            <>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await ownerCreateAdminOrModerator({ identifier: u.uid, role: 'moderator' });
                                    onToast(`Created Moderator account for @${u.username}`);
                                    void loadAdminData();
                                  } catch (err) {
                                    onToast(err instanceof Error ? err.message : 'Unable to create Moderator');
                                  }
                                }}
                                className="h-9 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold cursor-pointer"
                              >
                                + Moderator
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await ownerCreateAdminOrModerator({ identifier: u.uid, role: 'admin' });
                                    onToast(`Created Admin account for @${u.username}`);
                                    void loadAdminData();
                                  } catch (err) {
                                    onToast(err instanceof Error ? err.message : 'Unable to create Admin');
                                  }
                                }}
                                className="h-9 px-3 rounded-xl border border-[#0D6E6E] text-[#0D6E6E] dark:text-teal-400 text-xs font-semibold cursor-pointer"
                              >
                                + Admin
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Confirmation Modal for Suspend, Reactivate, Role Switch & Remove */}
          {pendingAdminConfirm && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="w-full max-w-md bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-4 shadow-xl">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
                        pendingAdminConfirm.action === 'remove'
                          ? 'bg-red-500/15 text-red-600'
                          : pendingAdminConfirm.action === 'reactivate'
                          ? 'bg-emerald-500/15 text-emerald-600'
                          : 'bg-amber-500/15 text-amber-600'
                      }`}
                    >
                      {pendingAdminConfirm.action === 'reactivate' ? (
                        <CheckCircle2 className="w-5 h-5" />
                      ) : (
                        <ShieldAlert className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <h4 className="font-display text-base font-bold">
                        {pendingAdminConfirm.action === 'suspend' && 'Confirm Suspend Account'}
                        {pendingAdminConfirm.action === 'reactivate' && 'Confirm Reactivate Account'}
                        {pendingAdminConfirm.action === 'remove' && 'Confirm Remove Privileges'}
                        {pendingAdminConfirm.action === 'switch_role' && 'Confirm Role Change'}
                      </h4>
                      <p className="text-xs text-zinc-500">Original Owner verification required</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={confirmBusy}
                    onClick={() => setPendingAdminConfirm(null)}
                    className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="rounded-2xl bg-[#F7F5F0] dark:bg-[#0E1113] p-3.5 text-xs space-y-1">
                  <p className="font-bold text-sm">{pendingAdminConfirm.displayName}</p>
                  {pendingAdminConfirm.email && <p className="text-zinc-500">{pendingAdminConfirm.email}</p>}
                  <p className="font-mono text-[11px] text-zinc-500">UID: {pendingAdminConfirm.uid}</p>
                </div>

                <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  {pendingAdminConfirm.action === 'suspend' &&
                    `Suspending immediately blocks ${pendingAdminConfirm.displayName} from accessing Admin/Moderator permissions until reactivated by you.`}
                  {pendingAdminConfirm.action === 'reactivate' &&
                    `Reactivating restores ${pendingAdminConfirm.currentRole} access for ${pendingAdminConfirm.displayName}.`}
                  {pendingAdminConfirm.action === 'remove' &&
                    `Removing permanently revokes all Admin/Moderator permissions from ${pendingAdminConfirm.displayName}. Their regular user account will remain intact.`}
                  {pendingAdminConfirm.action === 'switch_role' &&
                    `Change role for ${pendingAdminConfirm.displayName} from ${pendingAdminConfirm.currentRole} to ${pendingAdminConfirm.nextRole}.`}
                </p>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    disabled={confirmBusy}
                    onClick={() => setPendingAdminConfirm(null)}
                    className="h-10 px-4 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={confirmBusy}
                    onClick={async () => {
                      setConfirmBusy(true);
                      try {
                        if (pendingAdminConfirm.action === 'suspend') {
                          await ownerUpdateAdminStatusOrRole(pendingAdminConfirm.uid, { isSuspended: true });
                          onToast(`Suspended ${pendingAdminConfirm.displayName}`);
                        } else if (pendingAdminConfirm.action === 'reactivate') {
                          await ownerUpdateAdminStatusOrRole(pendingAdminConfirm.uid, { isSuspended: false });
                          onToast(`Reactivated ${pendingAdminConfirm.displayName}`);
                        } else if (pendingAdminConfirm.action === 'switch_role' && pendingAdminConfirm.nextRole) {
                          await ownerUpdateAdminStatusOrRole(pendingAdminConfirm.uid, {
                            role: pendingAdminConfirm.nextRole,
                          });
                          onToast(`Changed ${pendingAdminConfirm.displayName} to ${pendingAdminConfirm.nextRole}`);
                        } else if (pendingAdminConfirm.action === 'remove') {
                          await ownerRemoveAdminOrModerator(pendingAdminConfirm.uid);
                          onToast(`Removed ${pendingAdminConfirm.displayName} from Admin & Moderator team`);
                        }
                        setPendingAdminConfirm(null);
                        await loadAdminData();
                      } catch (err) {
                        onToast(err instanceof Error ? err.message : 'Action failed.');
                      } finally {
                        setConfirmBusy(false);
                      }
                    }}
                    className={`h-10 px-4 rounded-xl text-white text-xs font-bold cursor-pointer disabled:opacity-50 ${
                      pendingAdminConfirm.action === 'remove'
                        ? 'bg-red-600 hover:bg-red-700'
                        : pendingAdminConfirm.action === 'reactivate'
                        ? 'bg-emerald-600 hover:bg-emerald-700'
                        : 'bg-[#0D6E6E] hover:bg-[#095454]'
                    }`}
                  >
                    {confirmBusy ? 'Processing...' : 'Confirm'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2B. MONTHLY LEVEL & VIP SYSTEM CONFIG */}
      {section === 'levels' && (
        <div className="space-y-6">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await saveLevelConfigAdmin(currentUser.uid, {
                levels: levelDraft.levels,
                enableVipFrames: levelDraft.enableVipFrames,
                enableVipNameColors: levelDraft.enableVipNameColors,
                enableVipExclusiveEmojis: levelDraft.enableVipExclusiveEmojis,
                enableVipRoomAccess: levelDraft.enableVipRoomAccess,
                enableVipEntryAnimation: levelDraft.enableVipEntryAnimation,
                vipBadgeColor: levelDraft.vipBadgeColor || '#F59E0B',
              });
              await audit(
                'save_level_vip_config',
                'appSettings',
                'levelConfig',
                `VIP hours=${levelDraft.levels[4]?.minHours}h`
              );
              onToast('Monthly Level thresholds & VIP benefits updated');
            }}
            className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-4"
          >
            <h3 className="font-display text-base font-bold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <span>Monthly Speaking Levels &amp; VIP Perks</span>
            </h3>
            <p className="text-xs text-zinc-500">
              Adjust live audio speaking hour requirements for each monthly tier and toggle VIP rewards. Speaking hours reset automatically on the 1st of every month.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              {levelDraft.levels.map((tier, idx) => (
                <div
                  key={tier.level}
                  className="rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0]/60 dark:bg-[#0E1113]/60 p-3 space-y-2"
                >
                  <p className="text-[11px] font-bold text-[#0D6E6E] dark:text-teal-400">
                    Level {tier.level}
                  </p>
                  <input
                    type="text"
                    value={tier.badgeEmoji}
                    maxLength={4}
                    onChange={(e) => {
                      const next = [...levelDraft.levels];
                      next[idx] = { ...tier, badgeEmoji: e.target.value };
                      setLevelDraft((prev) => ({ ...prev, levels: next }));
                    }}
                    placeholder="Emoji"
                    className="w-full h-9 px-2.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-white dark:bg-[#171B1E] text-xs"
                  />
                  <input
                    type="text"
                    value={tier.name}
                    maxLength={28}
                    onChange={(e) => {
                      const next = [...levelDraft.levels];
                      next[idx] = { ...tier, name: e.target.value };
                      setLevelDraft((prev) => ({ ...prev, levels: next }));
                    }}
                    placeholder="Tier Name"
                    className="w-full h-9 px-2.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-white dark:bg-[#171B1E] text-xs font-semibold"
                  />
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      max={740}
                      value={tier.minHours}
                      onChange={(e) => {
                        const next = [...levelDraft.levels];
                        next[idx] = { ...tier, minHours: Math.max(1, Number(e.target.value) || 1) };
                        setLevelDraft((prev) => ({ ...prev, levels: next }));
                      }}
                      className="w-full h-9 px-2.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-white dark:bg-[#171B1E] text-xs font-mono"
                    />
                    <span className="text-[11px] text-zinc-500 shrink-0">hrs</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 space-y-1">
              {(
                [
                  { key: 'enableVipFrames', label: 'Unlock Golden VIP Profile Avatar Frames' },
                  { key: 'enableVipNameColors', label: 'Unlock VIP Gold Name Highlighting' },
                  { key: 'enableVipExclusiveEmojis', label: 'Unlock Exclusive VIP Audio Party Emojis' },
                  { key: 'enableVipRoomAccess', label: 'Enable VIP-Only Audio Room Creation & Access' },
                  { key: 'enableVipEntryAnimation', label: 'Enable VIP Grand Entry Animation in Audio Rooms' },
                ] as const
              ).map((item) => (
                <label
                  key={item.key}
                  className="flex items-center justify-between py-2 border-b border-[#E4DFD5]/60 dark:border-[#262C30]/60 text-sm cursor-pointer"
                >
                  <span>{item.label}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(levelDraft[item.key])}
                    onChange={(e) =>
                      setLevelDraft((prev) => ({ ...prev, [item.key]: e.target.checked }))
                    }
                    className="w-4 h-4 accent-[#0D6E6E]"
                  />
                </label>
              ))}
            </div>

            <button
              type="submit"
              className="h-11 px-6 rounded-xl bg-[#0D6E6E] text-white text-sm font-semibold cursor-pointer"
            >
              Save Levels &amp; VIP Configuration
            </button>
          </form>

          {/* Speaking Leaderboard & History Inspector */}
          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-4">
            <h3 className="font-display text-sm font-bold">
              Verified Monthly Speaking Activity ({users.length} users)
            </h3>
            {inspectHistoryUid && (
              <div className="rounded-2xl border border-[#0D6E6E] p-4 space-y-2 bg-[#F7F5F0]/60 dark:bg-[#0E1113]/60">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold">
                    Monthly History for {users.find((u) => u.uid === inspectHistoryUid)?.displayName || inspectHistoryUid}
                  </p>
                  <button
                    type="button"
                    onClick={() => setInspectHistoryUid(null)}
                    className="text-xs font-semibold text-zinc-500 cursor-pointer"
                  >
                    Close
                  </button>
                </div>
                {inspectedHistory.length === 0 ? (
                  <p className="text-xs text-zinc-500">No archived previous months yet.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {inspectedHistory.map((h) => (
                      <div
                        key={h.monthKey}
                        className="rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-white dark:bg-[#171B1E] px-3 py-2 text-xs"
                      >
                        <p className="font-bold">{h.monthKey}</p>
                        <p className="text-zinc-500">
                          Lv.{h.achievedLevel} {h.levelName} {h.wasVip ? '👑 VIP' : ''} · {formatSpeakingDuration(h.speakingSeconds)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="divide-y divide-[#E4DFD5] dark:divide-[#262C30]">
              {users
                .map((u) => ({
                  u,
                  st: speakingStatsMap[u.uid] || null,
                  sum: computeLevelSummary(speakingStatsMap[u.uid], levelConfig),
                }))
                .sort((a, b) => b.sum.activeSeconds - a.sum.activeSeconds)
                .slice(0, 30)
                .map(({ u, st, sum }) => (
                  <div key={u.uid} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar src={u.photoURL} name={u.displayName} size="sm" isVip={sum.isVip} />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold flex items-center gap-1.5 flex-wrap">
                          <span>{u.displayName}</span>
                          <LevelBadge stats={st} config={levelConfig} />
                        </p>
                        <p className="text-[11px] text-zinc-500 tabular-nums">
                          This Month: {formatSpeakingDuration(sum.activeSeconds)} · Lifetime: {formatSpeakingDuration(st?.lifetimeSeconds || 0)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        setInspectHistoryUid(u.uid);
                        const hist = await fetchUserSpeakingHistory(u.uid);
                        setInspectedHistory(hist);
                      }}
                      className="h-8 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold cursor-pointer"
                    >
                      View History
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* 3. AUDIO PARTY ROOMS CONTROL (OWNER + MODS) */}
      {section === 'audio' && (
        <div className="space-y-4">
          {inspectedRoom && (
            <div className="bg-white dark:bg-[#171B1E] border border-[#0D6E6E] rounded-3xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-bold">
                    Inspecting Room: {inspectedRoom.title}
                  </h3>
                  <p className="text-xs text-zinc-500">
                    Mute any speaker or remove &amp; ban disruptive participants immediately.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectRoomId(null)}
                  className="h-8 px-3 rounded-lg border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold cursor-pointer"
                >
                  Close Inspector
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {inspectParticipants.map((p) => (
                  <div
                    key={p.userId}
                    className="rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] p-3 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">
                        {p.displayName} ({p.role}{p.seatNumber > 0 ? ` · Seat #${p.seatNumber}` : ''})
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        {p.isBanned ? 'BANNED' : p.isMuted ? 'Muted' : 'Mic Live'}
                      </p>
                    </div>
                    {!p.isBanned && (
                      <div className="flex items-center gap-1.5">
                        {p.seatNumber > 0 && (
                          <button
                            type="button"
                            onClick={async () => {
                              await toggleParticipantMute(inspectedRoom.id, p.userId, p.isMuted);
                              await audit('mute_audio_speaker', 'audioParticipant', p.userId, `room=${inspectedRoom.id} muted=${!p.isMuted}`);
                              onToast(`Toggled mute for ${p.displayName}`);
                            }}
                            className="h-8 px-2.5 rounded-lg border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <MicOff className="w-3 h-3" />
                            <span>{p.isMuted ? 'Unmute' : 'Mute'}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            await banAudioParticipant(inspectedRoom, p.userId);
                            await audit('ban_audio_user', 'audioParticipant', p.userId, `Banned ${p.displayName} from ${inspectedRoom.title}`);
                            onToast(`Removed & banned ${p.displayName}`);
                          }}
                          className="h-8 px-2.5 rounded-lg bg-red-600 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Ban className="w-3 h-3" />
                          <span>Remove</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl divide-y divide-[#E4DFD5] dark:divide-[#262C30]">
            {audioRooms.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">No Audio Party rooms created yet.</div>
            ) : (
              audioRooms.map((room) => (
                <div key={room.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold flex items-center gap-2">
                      <span>{room.title}</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          room.status === 'live' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500'
                        }`}
                      >
                        {room.status.toUpperCase()} · {room.visibility.toUpperCase()}
                      </span>
                    </p>
                    <p className="text-xs text-zinc-500">
                      Host: {room.hostName} (@{room.hostUsername}) · {room.participantsCount} participants · {room.giftsCoinsTotal} gift coins
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setInspectRoomId(room.id)}
                      className="h-9 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold cursor-pointer"
                    >
                      Inspect Speakers
                    </button>
                    {room.status === 'live' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await endAudioRoom(room.id);
                          await audit('close_audio_room', 'audioRoom', room.id, `Closed room "${room.title}"`);
                          onToast(`Closed Audio Room "${room.title}"`);
                          void loadAdminData();
                        }}
                        className="h-9 px-3.5 rounded-xl bg-red-600 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <PhoneOff className="w-3.5 h-3.5" />
                        <span>Close Room</span>
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 4. ORIGINAL OWNER COIN ECONOMY, GIFTS, BONUSES, PROMO POOL & LEDGER */}
      {section === 'economy' && isOriginalOwner && (
        <OwnerCoinEconomyPanel
          currentUser={currentUser}
          users={users}
          gifts={gifts}
          coinPackages={coinPackages}
          wallets={wallets}
          transactions={transactions}
          topupRequests={topupRequests}
          onRefreshParent={loadAdminData}
          onAudit={audit}
          onToast={onToast}
        />
      )}

      {/* 5. POSTS MODERATION */}
      {section === 'posts' && (
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl divide-y divide-[#E4DFD5] dark:divide-[#262C30]">
          {posts.map((post) => (
            <div key={post.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  @{post.authorUsername} · {post.mediaType} ·{' '}
                  <span className={post.status === 'hidden' ? 'text-amber-600' : 'text-emerald-600'}>
                    {post.status}
                  </span>
                </p>
                <p className="text-xs text-zinc-500 truncate">
                  {post.caption || '(Media post without caption)'}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={async () => {
                    const next = post.status === 'active' ? 'hidden' : 'active';
                    await adminSetPostStatus(post.id, next);
                    await audit('moderate_post_visibility', 'post', post.id, `Set status=${next}`);
                    onToast(`Post marked ${next}`);
                    void loadAdminData();
                  }}
                  className="h-9 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  {post.status === 'active' ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  <span>{post.status === 'active' ? 'Hide' : 'Restore'}</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await adminDeletePost(post.id);
                    await audit('delete_post', 'post', post.id, `Deleted post by @${post.authorUsername}`);
                    onToast('Post permanently deleted');
                    void loadAdminData();
                  }}
                  className="h-9 px-3 rounded-xl bg-red-600 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 6. REPORTS */}
      {section === 'reports' && (
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl divide-y divide-[#E4DFD5] dark:divide-[#262C30]">
          {reports.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500">No abuse or moderation reports yet.</div>
          ) : (
            reports.map((rep) => (
              <div key={rep.id} className="p-5 flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-semibold">
                    {rep.reason} · <span className="text-[#0D6E6E]">{rep.targetType}</span> ({rep.status})
                  </p>
                  <p className="text-xs text-zinc-500">
                    Reported by @{rep.reporterUsername} · Target ID: {rep.targetId}
                  </p>
                  {rep.details && <p className="text-xs text-zinc-700 dark:text-zinc-300">{rep.details}</p>}
                </div>
                {(rep.status === 'open' || rep.status === 'reviewed') && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await adminUpdateReport(rep.id, 'resolved', 'Action taken by moderation');
                        await audit('resolve_report', 'report', rep.id, rep.reason);
                        onToast('Report resolved');
                      }}
                      className="h-9 px-3 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Resolve</span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await adminUpdateReport(rep.id, 'dismissed', 'No violation found');
                        await audit('dismiss_report', 'report', rep.id, rep.reason);
                        onToast('Report dismissed');
                      }}
                      className="h-9 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* 7. LIVE STREAMS */}
      {section === 'live' && (
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl divide-y divide-[#E4DFD5] dark:divide-[#262C30]">
          {liveStreams.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500">No active live streams right now.</div>
          ) : (
            liveStreams.map((stream) => (
              <div key={stream.id} className="p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{stream.title}</p>
                  <p className="text-xs text-zinc-500">
                    Host: {stream.hostName} (@{stream.hostUsername}) · {stream.viewersCount} viewers
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await endLiveStream(stream.id);
                    await audit('end_live_stream', 'liveStream', stream.id, stream.title);
                    onToast('Live broadcast ended by moderation');
                  }}
                  className="h-9 px-4 rounded-xl bg-red-600 text-white text-xs font-semibold cursor-pointer"
                >
                  Force End Stream
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* 8. SUPPORT TICKETS */}
      {section === 'tickets' && (
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl divide-y divide-[#E4DFD5] dark:divide-[#262C30]">
          {tickets.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500">No customer support tickets yet.</div>
          ) : (
            tickets.map((tkt) => (
              <div key={tkt.id} className="p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {tkt.subject} · <span className="text-[#0D6E6E]">@{tkt.username}</span> ({tkt.category})
                  </p>
                  <span className="text-xs font-bold uppercase text-amber-600">{tkt.status}</span>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">{tkt.message}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={ticketReplies[tkt.id] ?? tkt.adminReply ?? ''}
                    onChange={(e) => setTicketReplies((prev) => ({ ...prev, [tkt.id]: e.target.value }))}
                    placeholder="Write official reply..."
                    className="flex-1 min-w-[200px] h-10 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      await adminReplySupportTicket(tkt.id, 'resolved', ticketReplies[tkt.id] || 'Resolved by Owner Support.');
                      await audit('reply_support_ticket', 'supportTicket', tkt.id, tkt.subject);
                      onToast('Ticket reply saved & resolved');
                      void loadAdminData();
                    }}
                    className="h-10 px-4 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold cursor-pointer"
                  >
                    Reply &amp; Resolve
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 9. ANNOUNCEMENTS */}
      {section === 'announcements' && (
        <div className="space-y-4">
          <form
            onSubmit={handleCreateAnnouncement}
            className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-3"
          >
            <h3 className="font-display text-sm font-bold">Publish Platform Announcement</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                required
                maxLength={120}
                value={annTitle}
                onChange={(e) => setAnnTitle(e.target.value)}
                placeholder="Announcement Title"
                className="sm:col-span-2 h-10 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
              />
              <select
                value={annPriority}
                onChange={(e) => setAnnPriority(e.target.value as 'normal' | 'important')}
                className="h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
              >
                <option value="normal">Normal Notice</option>
                <option value="important">Important Alert</option>
              </select>
            </div>
            <textarea
              rows={2}
              required
              maxLength={1000}
              value={annMessage}
              onChange={(e) => setAnnMessage(e.target.value)}
              placeholder="Write your announcement shown to all Web & Android users..."
              className="w-full p-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm resize-none"
            />
            <button type="submit" className="h-10 px-5 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold cursor-pointer">
              Publish Announcement
            </button>
          </form>

          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl divide-y divide-[#E4DFD5] dark:divide-[#262C30]">
            {announcements.map((ann) => (
              <div key={ann.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">
                    {ann.title} · <span className="text-xs text-zinc-500">{ann.active ? 'Active' : 'Archived'}</span>
                  </p>
                  <p className="text-xs text-zinc-500">{ann.message}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await toggleAnnouncementActive(ann.id, !ann.active);
                      void loadAdminData();
                    }}
                    className="h-9 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold cursor-pointer"
                  >
                    {ann.active ? 'Archive' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await deleteAnnouncement(ann.id);
                      void loadAdminData();
                    }}
                    className="h-9 px-3 rounded-xl text-red-600 text-xs font-semibold cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 10. PLATFORM SETTINGS (OWNER ONLY) */}
      {section === 'settings' && isOriginalOwner && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-4"
        >
          <h3 className="font-display text-base font-bold flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#0D6E6E]" />
            <span>Global Privacy, Security &amp; Feature Controls</span>
          </h3>
          {(
            [
              { key: 'maintenanceMode', label: 'Maintenance Mode (only Original Owner & active Admins can sign in)' },
              { key: 'allowNewRegistrations', label: 'Allow New User Registrations' },
              { key: 'allowLiveStreaming', label: 'Allow Live Video Streaming' },
              { key: 'allowVideoReels', label: 'Allow Short Video Reels Uploads' },
              { key: 'allowAudioRooms', label: 'Allow BANDHU MELA Audio Party Rooms' },
              { key: 'allowVirtualGifts', label: 'Allow Animated Virtual Gifts' },
              { key: 'allowCoinPurchases', label: 'Allow Coin Purchases & Top-Up Orders' },
            ] as const
          ).map((item) => (
            <label key={item.key} className="flex items-center justify-between py-2 border-b border-[#E4DFD5]/60 dark:border-[#262C30]/60 text-sm cursor-pointer">
              <span>{item.label}</span>
              <input
                type="checkbox"
                checked={Boolean(settingsDraft[item.key] ?? true)}
                onChange={(e) =>
                  setSettingsDraft((prev) => ({ ...prev, [item.key]: e.target.checked }))
                }
                className="w-4 h-4 accent-[#0D6E6E]"
              />
            </label>
          ))}
          <div>
            <label className="text-xs font-semibold text-zinc-500">Platform Tagline / Welcome Headline</label>
            <input
              type="text"
              maxLength={160}
              value={settingsDraft.welcomeHeadline}
              onChange={(e) => setSettingsDraft((prev) => ({ ...prev, welcomeHeadline: e.target.value }))}
              className="mt-1 w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
            />
          </div>
          <button type="submit" className="h-11 px-6 rounded-xl bg-[#0D6E6E] text-white text-sm font-semibold cursor-pointer">
            Save Platform Settings
          </button>
        </form>
      )}

      {/* 11. SECURITY AUDIT LOG (OWNER ONLY) */}
      {section === 'audit' && isOriginalOwner && (
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl divide-y divide-[#E4DFD5] dark:divide-[#262C30]">
          {auditLogs.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500">
              Audit trail is append-only. Administrative actions will appear here.
            </div>
          ) : (
            auditLogs.map((log) => (
              <div key={log.id} className="p-4 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <p className="font-bold">
                    <span className="text-[#0D6E6E] dark:text-teal-400">{log.action}</span> · {log.actorName} ({log.actorRole})
                  </p>
                  <p className="text-zinc-500">
                    Target: {log.targetType}/{log.targetId} — {log.details}
                  </p>
                </div>
                <span className="text-[11px] text-zinc-400">{formatRelativeTime(log.createdAt)}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* 12. DATABASE BACKUP & RECOVERY (OWNER ONLY) */}
      {section === 'backup' && isOriginalOwner && (
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-5">
          <div>
            <h3 className="font-display text-base font-bold">Database Backup &amp; Disaster Recovery</h3>
            <p className="text-xs text-zinc-500 mt-1">
              Export a complete JSON snapshot of users, posts, audio rooms, wallets, transactions, virtual gifts, coin packages, announcements, audit logs, and platform settings.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={backupBusy}
              onClick={handleExportBackup}
              className="h-11 px-5 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export Full Database JSON</span>
            </button>

            <label className="h-11 px-5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold flex items-center gap-2 cursor-pointer">
              <Upload className="w-4 h-4 text-amber-500" />
              <span>Restore from Backup JSON</span>
              <input type="file" accept="application/json" onChange={handleRestoreFile} className="hidden" />
            </label>
          </div>
        </div>
      )}
    </div>
  );
};
