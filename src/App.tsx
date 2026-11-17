import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import {
  AudioLines,
  Bell,
  ChevronRight,
  Clock,
  Coins,
  Compass,
  Crown,
  Film,
  Flame,
  Globe,
  Home,
  Image as ImageIcon,
  LogOut,
  MessageCircle,
  Moon,
  Plus,
  Radio,
  Search,
  Shield,
  Sparkles,
  Sun,
  User as UserIcon,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { AuthView } from './components/AuthView';
import { Avatar } from './components/Avatar';
import { BandhuLogo } from './components/BandhuLogo';
import { CommentsModal } from './components/CommentsModal';
import { CreatePostModal } from './components/CreatePostModal';
import { LevelBadge } from './components/LevelBadge';
import { PostCard } from './components/PostCard';
import { ReportModal } from './components/ReportModal';
import { StoriesBar } from './components/StoriesBar';
import { VerifiedBadge } from './components/VerifiedBadge';
import { auth } from './lib/firebase';
import { t } from './lib/i18n';
import { ensureUserWallet, subscribeMyWallet } from './lib/audioPartyApi';
import {
  computeLevelSummary,
  DEFAULT_LEVEL_CONFIG,
  subscribeAllSpeakingStatsMap,
  subscribeLevelConfig,
  syncOrResetMonthlyCycle,
} from './lib/levelVipApi';
import {
  checkIsAdminRecord,
  claimAndVerifyOriginalOwner,
  createCallSession,
  DEFAULT_APP_SETTINGS,
  ensureUserProfile,
  getCachedFeedPosts,
  getCachedUsers,
  getSuggestedFriends,
  rankTrendingPosts,
  sendFriendRequest,
  setUserPresence,
  subscribeActiveAnnouncements,
  subscribeActiveStories,
  subscribeAllPresence,
  subscribeAllUsers,
  subscribeAppSettings,
  subscribeBlocks,
  subscribeConversations,
  subscribeFeedPosts,
  subscribeFriendRequests,
  subscribeLiveStreams,
  subscribeMyCalls,
  subscribeMyFollowing,
  subscribeNotifications,
  subscribeSavedPostIds,
  toggleFollowUser,
} from './lib/socialApi';

const AudioPartyView = lazy(() =>
  import('./components/AudioPartyView').then((m) => ({ default: m.AudioPartyView }))
);
const WalletModal = lazy(() =>
  import('./components/WalletModal').then((m) => ({ default: m.WalletModal }))
);

const CallOverlay = lazy(() =>
  import('./components/CallOverlay').then((m) => ({ default: m.CallOverlay }))
);
const ChatView = lazy(() =>
  import('./components/ChatView').then((m) => ({ default: m.ChatView }))
);
const CommunitiesEventsView = lazy(() =>
  import('./components/CommunitiesEventsView').then((m) => ({
    default: m.CommunitiesEventsView,
  }))
);
const FriendsView = lazy(() =>
  import('./components/FriendsView').then((m) => ({ default: m.FriendsView }))
);
const LiveStreamView = lazy(() =>
  import('./components/LiveStreamView').then((m) => ({ default: m.LiveStreamView }))
);
const NotificationsView = lazy(() =>
  import('./components/NotificationsView').then((m) => ({
    default: m.NotificationsView,
  }))
);
const OwnerAdminView = lazy(() =>
  import('./components/OwnerAdminView').then((m) => ({ default: m.OwnerAdminView }))
);
const PrivacyHelpLegalView = lazy(() =>
  import('./components/PrivacyHelpLegalView').then((m) => ({
    default: m.PrivacyHelpLegalView,
  }))
);
const ProfileView = lazy(() =>
  import('./components/ProfileView').then((m) => ({ default: m.ProfileView }))
);
const ReelsView = lazy(() =>
  import('./components/ReelsView').then((m) => ({ default: m.ReelsView }))
);
import {
  Announcement,
  AppSettings,
  AppTab,
  CallSession,
  Conversation,
  FriendRequest,
  LanguageCode,
  LevelConfig,
  LiveStream,
  MediaType,
  NotificationItem,
  Post,
  SpeakingStats,
  StoryItem,
  UserPresence,
  UserProfile,
  UserWallet,
} from './types/social';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOriginalOwner, setIsOriginalOwner] = useState(false);
  const [verifiedOwnerUid, setVerifiedOwnerUid] = useState<string | null>(null);
  const [ownerBackendVerified, setOwnerBackendVerified] = useState(false);
  const [wallet, setWallet] = useState<UserWallet | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('bandhu_theme') === 'dark';
  });
  const [lang, setLang] = useState<LanguageCode>(() => {
    return localStorage.getItem('bandhu_lang') === 'bn' ? 'bn' : 'en';
  });

  const [audioRoomFocusId] = useState<string | null>(() => {
    return new URLSearchParams(window.location.search).get('room');
  });
  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    return new URLSearchParams(window.location.search).get('room') ? 'audio' : 'home';
  });
  const [selectedProfileUid, setSelectedProfileUid] = useState<string | null>(null);
  const [chatPeerUid, setChatPeerUid] = useState<string | null>(null);
  const [liveStreamFocusId, setLiveStreamFocusId] = useState<string | null>(null);
  const [hashtagFilter, setHashtagFilter] = useState<string | null>(null);
  const [focusedPostId, setFocusedPostId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('post');
  });
  const [feedMode, setFeedMode] = useState<'latest' | 'trending'>('latest');
  const [feedLimit, setFeedLimit] = useState<number>(20);
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(() => {
    return localStorage.getItem('bandhu_onboarding_done') === '1';
  });

  const [posts, setPosts] = useState<Post[]>(() => getCachedFeedPosts());
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>(() => getCachedUsers());
  const [presenceMap, setPresenceMap] = useState<Record<string, UserPresence>>({});
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>([]);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [blockedByMe, setBlockedByMe] = useState<Set<string>>(new Set());
  const [blockedMe, setBlockedMe] = useState<Set<string>>(new Set());
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [levelConfig, setLevelConfig] = useState<LevelConfig>(DEFAULT_LEVEL_CONFIG);
  const [speakingStatsMap, setSpeakingStatsMap] = useState<Record<string, SpeakingStats>>({});
  const [activeCall, setActiveCall] = useState<CallSession | null>(null);

  const [composerDefaultType, setComposerDefaultType] = useState<MediaType | null>(null);
  const [commentPost, setCommentPost] = useState<Post | null>(null);
  const [reportTarget, setReportTarget] = useState<{
    type: 'post' | 'user' | 'comment';
    id: string;
    ownerId: string;
    label: string;
  } | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('bandhu_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem('bandhu_lang', lang);
  }, [lang]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      if (!user) {
        setCurrentUser(null);
        setIsAdmin(false);
        setIsOriginalOwner(false);
        setVerifiedOwnerUid(null);
        setOwnerBackendVerified(false);
        setWallet(null);
        setAuthReady(true);
        return;
      }

      if (!user.emailVerified) {
        setCurrentUser(null);
        setIsAdmin(false);
        setIsOriginalOwner(false);
        setVerifiedOwnerUid(null);
        setOwnerBackendVerified(false);
        setWallet(null);
        setAuthReady(true);
        return;
      }

      try {
        let signupOverrides: { displayName?: string; username?: string; phoneNumber?: string } | undefined;
        const pendingRaw = localStorage.getItem('bandhu_pending_signup');
        if (pendingRaw) {
          signupOverrides = JSON.parse(pendingRaw);
          localStorage.removeItem('bandhu_pending_signup');
        }
        const profile = await ensureUserProfile(user, signupOverrides);
        setCurrentUser(profile);
        void ensureUserWallet(user.uid).catch(() => {});
        const ownerStatus = await claimAndVerifyOriginalOwner(user);
        setIsOriginalOwner(ownerStatus.isOriginalOwner);
        setVerifiedOwnerUid(ownerStatus.ownerUid);
        setOwnerBackendVerified(ownerStatus.backendVerified);
        const adminDocMatch = ownerStatus.isOriginalOwner ? true : await checkIsAdminRecord(user.uid);
        setIsAdmin(ownerStatus.isOriginalOwner || adminDocMatch);
      } catch (err) {
        console.error('Auth hydration error:', err);
      } finally {
        setAuthReady(true);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    void setUserPresence(currentUser.uid, true);

    const handleBeforeUnload = () => {
      void setUserPresence(currentUser.uid, false);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    const unsubs = [
      subscribeActiveStories(setStories),
      subscribeAllUsers(setAllUsers),
      subscribeAllPresence(setPresenceMap),
      subscribeLiveStreams(setLiveStreams),
      subscribeMyFollowing(currentUser.uid, setFollowingIds),
      subscribeSavedPostIds(currentUser.uid, setSavedIds),
      subscribeFriendRequests(currentUser.uid, setFriendRequests),
      subscribeConversations(currentUser.uid, setConversations),
      subscribeNotifications(currentUser.uid, setNotifications),
      subscribeBlocks(currentUser.uid, (byMe, me) => {
        setBlockedByMe(byMe);
        setBlockedMe(me);
      }),
      subscribeActiveAnnouncements(setAnnouncements),
      subscribeAppSettings(setAppSettings),
      subscribeLevelConfig(setLevelConfig),
      subscribeAllSpeakingStatsMap(setSpeakingStatsMap),
      subscribeMyWallet(currentUser.uid, setWallet),
      subscribeMyCalls(currentUser.uid, (calls) => {
        const incoming = calls.find(
          (c) => c.calleeId === currentUser.uid && c.status === 'ringing'
        );
        if (incoming) {
          setActiveCall((prev) => prev || incoming);
        }
      }),
    ];

    void syncOrResetMonthlyCycle(currentUser.uid, levelConfig).catch(() => {});

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      void setUserPresence(currentUser.uid, false);
      unsubs.forEach((fn) => fn());
    };
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser) return;
    return subscribeFeedPosts(setPosts, undefined, feedLimit);
  }, [currentUser?.uid, feedLimit]);

  const blockedAll = useMemo(() => {
    const combined = new Set<string>(blockedByMe);
    blockedMe.forEach((id) => combined.add(id));
    return combined;
  }, [blockedByMe, blockedMe]);

  const verifiedUserIds = useMemo(() => {
    const s = new Set<string>();
    allUsers.forEach((u) => {
      if (u.isVerified) s.add(u.uid);
    });
    if (currentUser?.isVerified) s.add(currentUser.uid);
    return s;
  }, [allUsers, currentUser?.isVerified, currentUser?.uid]);

  const visiblePosts = useMemo(() => {
    const filtered = posts.filter((p) => {
      if (blockedAll.has(p.authorId)) return false;
      if (hashtagFilter && !p.hashtags.includes(hashtagFilter)) return false;
      if (focusedPostId) return p.id === focusedPostId;
      return true;
    });
    return feedMode === 'trending' && !focusedPostId ? rankTrendingPosts(filtered) : filtered;
  }, [posts, blockedAll, hashtagFilter, focusedPostId, feedMode]);

  const suggestedFriends = useMemo(() => {
    if (!currentUser) return [];
    return getSuggestedFriends(currentUser, allUsers, followingIds, friendRequests, blockedAll).slice(0, 6);
  }, [currentUser, allUsers, followingIds, friendRequests, blockedAll]);

  const onlineFriends = useMemo(() => {
    if (!currentUser) return [];
    return allUsers
      .filter(
        (u) =>
          u.uid !== currentUser.uid &&
          !blockedAll.has(u.uid) &&
          u.showOnlineStatus !== false &&
          Boolean(presenceMap[u.uid]?.isOnline)
      )
      .slice(0, 14);
  }, [allUsers, currentUser, blockedAll, presenceMap]);

  const trendingPreview = useMemo(() => {
    return rankTrendingPosts(posts.filter((p) => !blockedAll.has(p.authorId))).slice(0, 3);
  }, [posts, blockedAll]);

  const showOnboardingCard =
    Boolean(currentUser) &&
    !onboardingDismissed &&
    !focusedPostId &&
    (currentUser?.postsCount || 0) === 0 &&
    followingIds.size === 0;

  const reels = useMemo(
    () => posts.filter((p) => p.mediaType === 'reel' && !blockedAll.has(p.authorId)),
    [posts, blockedAll]
  );

  const savedPosts = useMemo(
    () => posts.filter((p) => savedIds.has(p.id) && !blockedAll.has(p.authorId)),
    [posts, savedIds, blockedAll]
  );

  const unreadNotifications = notifications.filter((n) => !n.read).length;
  const pendingFriendCount = friendRequests.filter(
    (r) => r.receiverId === currentUser?.uid && r.status === 'pending'
  ).length;

  const trendingHashtags = useMemo(() => {
    const counts = new Map<string, number>();
    posts.forEach((p) => {
      p.hashtags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag]) => tag);
  }, [posts]);

  const handleRefreshVerified = async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    if (auth.currentUser.emailVerified) {
      const profile = await ensureUserProfile(auth.currentUser);
      setCurrentUser(profile);
      void ensureUserWallet(auth.currentUser.uid).catch(() => {});
      const ownerStatus = await claimAndVerifyOriginalOwner(auth.currentUser);
      setIsOriginalOwner(ownerStatus.isOriginalOwner);
      setVerifiedOwnerUid(ownerStatus.ownerUid);
      setOwnerBackendVerified(ownerStatus.backendVerified);
      setIsAdmin(ownerStatus.isOriginalOwner || (await checkIsAdminRecord(auth.currentUser.uid)));
    } else {
      showToast('Email is not verified yet. Check your inbox and click the link first.');
    }
  };

  const handleStartCall = async (peer: UserProfile, callType: 'audio' | 'video') => {
    if (!currentUser) return;
    if (blockedAll.has(peer.uid)) {
      showToast('Cannot call a blocked user.');
      return;
    }
    try {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      if (callType === 'video') {
        pc.addTransceiver('video', { direction: 'sendrecv' });
      }
      const offer = await pc.createOffer();
      pc.close();
      const session = await createCallSession({
        caller: currentUser,
        callee: peer,
        callType,
        offerSdp: JSON.stringify(offer),
      });
      setActiveCall(session);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to start call');
    }
  };

  const openUserProfile = (uid: string) => {
    setSelectedProfileUid(uid);
    setActiveTab('profile');
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F8F7FB] dark:bg-[#0B0B10] flex flex-col items-center justify-center gap-3 text-zinc-700 dark:text-zinc-300">
        <BandhuLogo size={54} useIconAsset />
        <p className="font-display text-xl font-extrabold bandhu-gradient-text">BANDHU MELA</p>
      </div>
    );
  }

  if (!authUser || !authUser.emailVerified || !currentUser) {
    return (
      <AuthView
        unverifiedUser={authUser && !authUser.emailVerified ? authUser : null}
        lang={lang}
        darkMode={darkMode}
        allowNewRegistrations={appSettings.allowNewRegistrations}
        onToggleLang={() => setLang((l) => (l === 'en' ? 'bn' : 'en'))}
        onToggleTheme={() => setDarkMode((d) => !d)}
        onVerifiedRefresh={handleRefreshVerified}
      />
    );
  }

  if (currentUser.isSuspended && !isAdmin) {
    return (
      <div className="min-h-screen bg-[#F8F7FB] dark:bg-[#0B0B10] flex items-center justify-center p-6">
        <div className="max-w-md bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] rounded-3xl p-8 text-center space-y-4">
          <BandhuLogo size={48} useIconAsset className="mx-auto" />
          <h1 className="font-display text-xl font-bold">Account Suspended</h1>
          <p className="text-sm text-zinc-500">
            Your account is temporarily suspended by BANDHU MELA moderation.
          </p>
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="h-11 px-6 rounded-xl bandhu-gradient text-white text-sm font-semibold cursor-pointer"
          >
            {t(lang, 'signOut')}
          </button>
        </div>
      </div>
    );
  }

  if (appSettings.maintenanceMode && !isAdmin) {
    return (
      <div className="min-h-screen bg-[#F8F7FB] dark:bg-[#0B0B10] flex items-center justify-center p-6">
        <div className="max-w-md bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] rounded-3xl p-8 text-center space-y-4">
          <BandhuLogo size={48} useIconAsset className="mx-auto" />
          <h1 className="font-display text-xl font-bold">Scheduled Maintenance</h1>
          <p className="text-sm text-zinc-500">
            BANDHU MELA is undergoing brief maintenance by the owner. Please check back shortly.
          </p>
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="h-11 px-6 rounded-xl border border-[#E7E3F0] dark:border-[#252336] text-sm font-semibold cursor-pointer"
          >
            {t(lang, 'signOut')}
          </button>
        </div>
      </div>
    );
  }

  const profileTarget =
    allUsers.find((u) => u.uid === (selectedProfileUid || currentUser.uid)) || currentUser;

  const desktopNavItems: { id: AppTab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }[] = [
    { id: 'home', label: t(lang, 'home'), icon: Home },
    { id: 'friends', label: t(lang, 'friends'), icon: Users, badge: pendingFriendCount },
    { id: 'reels', label: t(lang, 'reels'), icon: Film },
    { id: 'audio', label: t(lang, 'audioParty'), icon: AudioLines },
    { id: 'live', label: t(lang, 'live'), icon: Radio, badge: liveStreams.length },
    { id: 'chat', label: t(lang, 'chat'), icon: MessageCircle },
    { id: 'communities', label: t(lang, 'communities'), icon: Compass },
    { id: 'notifications', label: t(lang, 'notifications'), icon: Bell, badge: unreadNotifications },
    { id: 'profile', label: t(lang, 'profile'), icon: UserIcon },
    { id: 'privacy', label: t(lang, 'privacy'), icon: Shield },
    ...(isAdmin
      ? [{ id: 'moderation' as AppTab, label: isOriginalOwner ? t(lang, 'ownerPanel') : t(lang, 'moderation'), icon: Crown }]
      : []),
  ];

  const mobileBottomItems: { id: AppTab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }[] = [
    { id: 'home', label: t(lang, 'home'), icon: Home },
    { id: 'friends', label: t(lang, 'friends'), icon: Users, badge: pendingFriendCount },
    { id: 'reels', label: t(lang, 'reels'), icon: Film },
    { id: 'notifications', label: t(lang, 'notifications'), icon: Bell, badge: unreadNotifications },
    { id: 'profile', label: t(lang, 'profile'), icon: UserIcon },
  ];

  return (
    <div className="min-h-screen bg-[#F8F7FB] dark:bg-[#0B0B10] text-[#14131A] dark:text-[#F4F3FA] pb-20 lg:pb-8">
      {/* Mobile Compact Header */}
      <header className="lg:hidden sticky top-0 z-30 h-14 px-3.5 bg-[#F8F7FB]/90 dark:bg-[#0B0B10]/90 backdrop-blur-md border-b border-[#E7E3F0] dark:border-[#252336] flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setActiveTab('home');
            setHashtagFilter(null);
            setFocusedPostId(null);
          }}
          className="flex items-center gap-2 shrink-0 cursor-pointer"
        >
          <BandhuLogo size={30} useIconAsset />
          <span className="font-display text-base font-extrabold tracking-tight bandhu-gradient-text whitespace-nowrap">
            {t(lang, 'brand')}
          </span>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('audio')}
            aria-label={t(lang, 'audioParty')}
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-violet-500/10 cursor-pointer"
          >
            <AudioLines className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('notifications')}
            aria-label={t(lang, 'notifications')}
            className="w-9 h-9 rounded-xl flex items-center justify-center relative hover:bg-violet-500/10 cursor-pointer"
          >
            <Bell className="w-4 h-4 text-pink-600 dark:text-pink-400" />
            {unreadNotifications > 0 && (
              <span className="absolute top-1 right-1 min-w-[14px] h-3.5 px-1 rounded-full bandhu-gradient text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
                {unreadNotifications}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            aria-label={t(lang, 'chat')}
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-violet-500/10 cursor-pointer"
          >
            <MessageCircle className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          </button>
          <button
            type="button"
            onClick={() => setWalletOpen(true)}
            aria-label={t(lang, 'wallet')}
            className="h-9 px-2 rounded-xl flex items-center gap-1 hover:bg-orange-500/10 text-orange-600 dark:text-orange-400 text-xs font-bold tabular-nums cursor-pointer"
          >
            <Coins className="w-3.5 h-3.5" />
            <span>{wallet?.coinsBalance ?? 0}</span>
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('moderation')}
              aria-label={t(lang, 'moderation')}
              className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-orange-500/10 cursor-pointer"
            >
              <Crown className="w-4 h-4 text-orange-500" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setDarkMode((d) => !d)}
            aria-label="Toggle theme"
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
          >
            {darkMode ? <Sun className="w-4 h-4 text-orange-400" /> : <Moon className="w-4 h-4 text-zinc-700" />}
          </button>
          <button
            type="button"
            onClick={() => setLang((l) => (l === 'en' ? 'bn' : 'en'))}
            className="h-8 px-2 rounded-xl border border-[#E7E3F0] dark:border-[#252336] text-[11px] font-bold cursor-pointer"
          >
            {lang === 'en' ? 'বাং' : 'EN'}
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-3.5 sm:px-4 lg:px-6 lg:py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Desktop Left Navigation Rail */}
        <aside className="hidden lg:flex lg:col-span-3 sticky top-6 flex-col gap-4">
          <div className="bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] rounded-3xl p-5 space-y-5 shadow-xs">
            <button
              type="button"
              onClick={() => {
                setActiveTab('home');
                setHashtagFilter(null);
                setFocusedPostId(null);
              }}
              className="flex items-center gap-3 text-left cursor-pointer"
            >
              <BandhuLogo size={40} useIconAsset />
              <div>
                <p className="font-display text-lg font-extrabold tracking-tight leading-none bandhu-gradient-text">
                  {t(lang, 'brand')}
                </p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium mt-1">
                  {t(lang, 'tagline')}
                </p>
              </div>
            </button>

            <nav className="space-y-1">
              {desktopNavItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (item.id === 'profile') setSelectedProfileUid(currentUser.uid);
                      setActiveTab(item.id);
                    }}
                    className={`w-full h-11 px-3.5 rounded-2xl flex items-center justify-between text-sm font-semibold transition-all cursor-pointer ${
                      active
                        ? 'bandhu-gradient text-white shadow-sm shadow-violet-500/20'
                        : 'text-zinc-700 dark:text-zinc-300 hover:bg-[#F8F7FB] dark:hover:bg-[#1B1927]'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="whitespace-nowrap">{item.label}</span>
                    </span>
                    {typeof item.badge === 'number' && item.badge > 0 && (
                      <span
                        className={`text-xs font-mono tabular-nums font-bold ${
                          active ? 'text-white' : 'text-pink-600 dark:text-pink-400'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <button
              type="button"
              onClick={() => setComposerDefaultType('image')}
              className="w-full h-11 rounded-2xl bandhu-gradient hover:opacity-95 text-white font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer transition-opacity shadow-sm shadow-violet-500/20"
            >
              <Plus className="w-4 h-4" />
              <span>{t(lang, 'createPost')}</span>
            </button>

            <button
              type="button"
              onClick={() => setWalletOpen(true)}
              className="w-full h-11 px-3.5 rounded-2xl border border-[#E7E3F0] dark:border-[#252336] hover:border-orange-400 flex items-center justify-between text-xs font-semibold cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-orange-500" />
                <span>{t(lang, 'wallet')}</span>
              </span>
              <span className="font-mono tabular-nums font-bold text-violet-600 dark:text-violet-400">
                {wallet?.coinsBalance ?? 0}
              </span>
            </button>

            <div className="pt-3 border-t border-[#E7E3F0] dark:border-[#252336] flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setDarkMode((d) => !d)}
                className="flex-1 h-9 rounded-xl border border-[#E7E3F0] dark:border-[#252336] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer hover:border-violet-400"
              >
                {darkMode ? <Sun className="w-3.5 h-3.5 text-orange-400" /> : <Moon className="w-3.5 h-3.5 text-violet-600" />}
                <span>{darkMode ? 'Light' : 'Dark'}</span>
              </button>
              <button
                type="button"
                onClick={() => setLang((l) => (l === 'en' ? 'bn' : 'en'))}
                className="flex-1 h-9 rounded-xl border border-[#E7E3F0] dark:border-[#252336] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer hover:border-violet-400"
              >
                <Globe className="w-3.5 h-3.5 text-pink-500" />
                <span>{t(lang, 'language')}</span>
              </button>
              <button
                type="button"
                onClick={() => signOut(auth)}
                aria-label={t(lang, 'signOut')}
                className="w-9 h-9 rounded-xl border border-[#E7E3F0] dark:border-[#252336] flex items-center justify-center text-zinc-500 hover:text-red-600 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* Main Center Workspace */}
        <main className="lg:col-span-9 py-4 lg:py-0 space-y-5">
          {/* Active Platform Announcements */}
          {announcements.length > 0 && activeTab === 'home' && (
            <div className="space-y-2">
              {announcements.slice(0, 2).map((ann) => (
                <div
                  key={ann.id}
                  className={`rounded-2xl border px-5 py-3.5 flex items-start justify-between gap-3 ${
                    ann.priority === 'important'
                      ? 'bg-orange-50 dark:bg-orange-950/30 border-orange-300 dark:border-orange-800'
                      : 'bg-white dark:bg-[#14131D] border-[#E7E3F0] dark:border-[#252336]'
                  }`}
                >
                  <div>
                    <p className="text-xs font-bold text-violet-600 dark:text-violet-400">
                      {ann.priority === 'important' ? 'Important Notice' : 'Announcement'} · {ann.title}
                    </p>
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-0.5">{ann.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'home' && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
              <div className="xl:col-span-8 space-y-5">
                {/* Welcome Header & Profile Shortcut Banner */}
                <section className="bm-enter bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] rounded-3xl p-4 sm:p-5 relative overflow-hidden">
                  <div className="absolute inset-x-0 top-0 h-1 bandhu-gradient" />
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                          {lang === 'bn' ? 'স্বাগতম বন্ধু মেলায়' : 'BANDHU MELA Courtyard'}
                        </span>
                      </div>
                      <h1 className="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-zinc-950 dark:text-white [text-wrap:balance]">
                        {lang === 'bn'
                          ? `নমস্কার, ${currentUser.displayName.split(' ')[0]}`
                          : `Welcome back, ${currentUser.displayName.split(' ')[0]}`}
                      </h1>
                      <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 line-clamp-1">
                        {appSettings.welcomeHeadline || t(lang, 'tagline')}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums pt-0.5">
                        {onlineFriends.length} online · {liveStreams.length} live · {reels.length} reels
                      </p>
                    </div>

                    {/* Profile Shortcut Tile */}
                    <button
                      type="button"
                      onClick={() => openUserProfile(currentUser.uid)}
                      className="flex items-center gap-3 p-2.5 pr-3.5 rounded-2xl bg-[#F8F7FB] dark:bg-[#0B0B10] border border-[#E7E3F0] dark:border-[#252336] hover:border-violet-400 dark:hover:border-violet-500 transition-colors cursor-pointer text-left shrink-0"
                    >
                      <div className="relative">
                        <Avatar
                          src={currentUser.photoURL}
                          name={currentUser.displayName}
                          size="md"
                          isVip={
                            computeLevelSummary(speakingStatsMap[currentUser.uid], levelConfig).isVip &&
                            levelConfig.enableVipFrames
                          }
                        />
                        <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-[#F8F7FB] dark:ring-[#0B0B10]" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-bold text-zinc-950 dark:text-white truncate max-w-[120px]">
                            {currentUser.displayName}
                          </span>
                          {currentUser.isVerified && <VerifiedBadge className="w-3.5 h-3.5 shrink-0" />}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[11px] text-zinc-500 truncate max-w-[90px]">
                            @{currentUser.username}
                          </span>
                          <LevelBadge stats={speakingStatsMap[currentUser.uid]} config={levelConfig} compact />
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                    </button>
                  </div>

                  {/* Quick Feature Shortcuts: Audio Party, Reels, Live, Messages, Notifications */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4 pt-4 border-t border-[#E7E3F0] dark:border-[#252336]">
                    <button
                      type="button"
                      onClick={() => setActiveTab('audio')}
                      className="min-h-[48px] px-3 py-2 rounded-2xl bandhu-gradient-soft border border-violet-500/20 hover:border-violet-500/50 flex items-center gap-2.5 text-left transition-colors cursor-pointer"
                    >
                      <div className="w-8 h-8 rounded-xl bandhu-gradient text-white flex items-center justify-center shrink-0">
                        <AudioLines className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{t(lang, 'audioParty')}</p>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">Voice rooms</p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('reels')}
                      className="min-h-[48px] px-3 py-2 rounded-2xl bg-pink-500/8 hover:bg-pink-500/14 border border-pink-500/20 flex items-center gap-2.5 text-left transition-colors cursor-pointer"
                    >
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 text-white flex items-center justify-center shrink-0">
                        <Film className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{t(lang, 'reels')}</p>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate tabular-nums">
                          {reels.length} videos
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('chat')}
                      className="min-h-[48px] px-3 py-2 rounded-2xl bg-violet-500/8 hover:bg-violet-500/14 border border-violet-500/20 flex items-center gap-2.5 text-left transition-colors cursor-pointer"
                    >
                      <div className="w-8 h-8 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0">
                        <MessageCircle className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{t(lang, 'chat')}</p>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate tabular-nums">
                          {conversations.length} chats
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('notifications')}
                      className="min-h-[48px] px-3 py-2 rounded-2xl bg-orange-500/8 hover:bg-orange-500/14 border border-orange-500/20 flex items-center gap-2.5 text-left transition-colors cursor-pointer"
                    >
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-500 to-pink-500 text-white flex items-center justify-center shrink-0">
                        <Bell className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{t(lang, 'notifications')}</p>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate tabular-nums">
                          {unreadNotifications > 0 ? `${unreadNotifications} new` : 'All caught up'}
                        </p>
                      </div>
                    </button>
                  </div>
                </section>

                {/* Online Friends Real-Time Indicator Strip */}
                <section className="bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] rounded-3xl p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                      <h2 className="font-display text-sm font-bold">
                        {lang === 'bn' ? 'অনলাইন বন্ধু' : 'Online Friends'}
                      </h2>
                      <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                        ({onlineFriends.length})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('friends')}
                      className="text-xs font-semibold text-violet-600 dark:text-violet-400 hover:underline cursor-pointer"
                    >
                      View Directory
                    </button>
                  </div>

                  {onlineFriends.length === 0 ? (
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl bg-[#F8F7FB] dark:bg-[#0B0B10] text-xs text-zinc-500">
                      <span>No friends currently online. Join Audio Party or browse people nearby.</span>
                      <button
                        type="button"
                        onClick={() => setActiveTab('friends')}
                        className="px-3 h-8 rounded-xl bandhu-gradient text-white font-semibold shrink-0 cursor-pointer"
                      >
                        Discover
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 overflow-x-auto no-scrollbar pb-1">
                      {onlineFriends.map((friend) => (
                        <div
                          key={friend.uid}
                          className="w-[78px] shrink-0 flex flex-col items-center gap-1.5"
                        >
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => openUserProfile(friend.uid)}
                              className="rounded-full ring-2 ring-emerald-500/70 p-0.5 cursor-pointer block"
                              aria-label={`View ${friend.displayName}`}
                            >
                              <Avatar
                                src={friend.photoURL}
                                name={friend.displayName}
                                size="md"
                                isVip={
                                  computeLevelSummary(speakingStatsMap[friend.uid], levelConfig).isVip &&
                                  levelConfig.enableVipFrames
                                }
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setChatPeerUid(friend.uid);
                                setActiveTab('chat');
                              }}
                              aria-label={`Message ${friend.displayName}`}
                              className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-violet-600 text-white border-2 border-white dark:border-[#14131D] flex items-center justify-center cursor-pointer"
                            >
                              <MessageCircle className="w-3 h-3" />
                            </button>
                          </div>
                          <span className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-200 truncate w-full text-center">
                            {friend.displayName.split(' ')[0]}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <StoriesBar
                  currentUser={currentUser}
                  stories={stories.filter((s) => !blockedAll.has(s.authorId))}
                  liveStreams={liveStreams.filter((l) => !blockedAll.has(l.hostId))}
                  lang={lang}
                  onOpenLive={(streamId) => {
                    setLiveStreamFocusId(streamId || null);
                    setActiveTab('live');
                  }}
                />

                {/* Post Composer Card */}
                <div className="bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] rounded-3xl p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Avatar src={currentUser.photoURL} name={currentUser.displayName} size="md" />
                    <button
                      type="button"
                      onClick={() => setComposerDefaultType('image')}
                      className="flex-1 h-11 px-4 rounded-2xl bg-[#F8F7FB] dark:bg-[#0B0B10] text-left text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer truncate"
                    >
                      {t(lang, 'whatsOnMind')}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E7E3F0] dark:border-[#252336]">
                    <button
                      type="button"
                      onClick={() => setComposerDefaultType('image')}
                      className="h-10 px-3.5 rounded-xl bg-[#F8F7FB] dark:bg-[#0B0B10] text-xs font-semibold flex items-center gap-1.5 hover:bg-violet-600 hover:text-white transition-colors cursor-pointer"
                    >
                      <ImageIcon className="w-3.5 h-3.5 text-violet-500" />
                      <span>Photo / Text</span>
                    </button>
                    {appSettings.allowVideoReels && (
                      <button
                        type="button"
                        onClick={() => setComposerDefaultType('reel')}
                        className="h-10 px-3.5 rounded-xl bg-[#F8F7FB] dark:bg-[#0B0B10] text-xs font-semibold flex items-center gap-1.5 hover:bg-pink-600 hover:text-white transition-colors cursor-pointer"
                      >
                        <Film className="w-3.5 h-3.5 text-pink-500" />
                        <span>Upload Reel</span>
                      </button>
                    )}
                    {appSettings.allowLiveStreaming && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('live')}
                        className="h-10 px-3.5 rounded-xl bg-orange-500/12 text-orange-700 dark:text-orange-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-orange-500 hover:text-white transition-colors cursor-pointer"
                      >
                        <Radio className="w-3.5 h-3.5" />
                        <span>{t(lang, 'goLive')}</span>
                      </button>
                    )}
                    {appSettings.allowAudioRooms && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('audio')}
                        className="h-10 px-3.5 rounded-xl bandhu-gradient-soft text-violet-700 dark:text-violet-300 text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 transition-opacity cursor-pointer"
                      >
                        <AudioLines className="w-3.5 h-3.5" />
                        <span>{t(lang, 'audioParty')}</span>
                      </button>
                    )}
                  </div>
                </div>

                {showOnboardingCard && (
                  <div className="bg-white dark:bg-[#14131D] border border-violet-500/35 rounded-3xl p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bandhu-gradient text-white flex items-center justify-center shrink-0">
                          <Sparkles className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="font-display text-sm font-bold">
                            Welcome to BANDHU MELA, {currentUser.displayName.split(' ')[0]}
                          </h3>
                          <p className="text-xs text-zinc-500">
                            Finish 3 quick steps to connect with friends and personalize your courtyard
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          localStorage.setItem('bandhu_onboarding_done', '1');
                          setOnboardingDismissed(true);
                        }}
                        aria-label="Dismiss welcome steps"
                        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <button
                        type="button"
                        onClick={() => openUserProfile(currentUser.uid)}
                        className="h-11 px-3.5 rounded-2xl bg-[#F8F7FB] dark:bg-[#0B0B10] hover:border-violet-500 border border-[#E7E3F0] dark:border-[#252336] text-xs font-semibold text-left cursor-pointer"
                      >
                        1. Add Photo &amp; Bio
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('friends')}
                        className="h-11 px-3.5 rounded-2xl bg-[#F8F7FB] dark:bg-[#0B0B10] hover:border-violet-500 border border-[#E7E3F0] dark:border-[#252336] text-xs font-semibold text-left cursor-pointer"
                      >
                        2. Find Friends
                      </button>
                      <button
                        type="button"
                        onClick={() => setComposerDefaultType('image')}
                        className="h-11 px-3.5 rounded-2xl bandhu-gradient text-white text-xs font-semibold text-left cursor-pointer"
                      >
                        3. Share First Post
                      </button>
                    </div>
                  </div>
                )}

                {/* Mobile Friend Suggestions Discovery Strip */}
                {suggestedFriends.length > 0 && !focusedPostId && (
                  <div className="xl:hidden bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] rounded-3xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-sm font-bold">Suggested Friends</h3>
                      <button
                        type="button"
                        onClick={() => setActiveTab('friends')}
                        className="text-xs font-semibold text-violet-600 dark:text-violet-400 cursor-pointer"
                      >
                        See All
                      </button>
                    </div>
                    <div className="flex items-stretch gap-3 overflow-x-auto no-scrollbar pb-1">
                      {suggestedFriends.map((person) => {
                        const isFollowing = followingIds.has(person.uid);
                        const isPersonOnline = Boolean(presenceMap[person.uid]?.isOnline);
                        return (
                          <div
                            key={person.uid}
                            className="w-44 shrink-0 rounded-2xl border border-[#E7E3F0] dark:border-[#252336] bg-[#F8F7FB]/80 dark:bg-[#0B0B10]/80 p-3 flex flex-col justify-between gap-2.5"
                          >
                            <button
                              type="button"
                              onClick={() => openUserProfile(person.uid)}
                              className="flex items-center gap-2 text-left cursor-pointer min-w-0"
                            >
                              <div className="relative">
                                <Avatar src={person.photoURL} name={person.displayName} size="sm" />
                                {isPersonOnline && (
                                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#0B0B10]" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-semibold truncate flex items-center gap-1">
                                  <span className="truncate">{person.displayName}</span>
                                  {person.isVerified && <VerifiedBadge className="w-3 h-3 shrink-0" />}
                                </p>
                                <p className="text-[11px] text-zinc-500 truncate">
                                  {person.location || `@${person.username}`}
                                </p>
                              </div>
                            </button>
                            <div className="grid grid-cols-2 gap-1.5">
                              <button
                                type="button"
                                onClick={() => toggleFollowUser(currentUser, person.uid, isFollowing)}
                                className={`h-8 rounded-xl text-[11px] font-semibold cursor-pointer ${
                                  isFollowing
                                    ? 'border border-[#E7E3F0] dark:border-[#252336]'
                                    : 'bandhu-gradient text-white'
                                }`}
                              >
                                {isFollowing ? t(lang, 'following') : t(lang, 'follow')}
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  await sendFriendRequest(currentUser, person);
                                  showToast(`Friend request sent to ${person.displayName}`);
                                }}
                                className="h-8 rounded-xl border border-[#E7E3F0] dark:border-[#252336] text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer hover:border-violet-400"
                              >
                                <UserPlus className="w-3 h-3 text-violet-600 dark:text-violet-400" />
                                <span>Add</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Feed Mode Bar: Latest vs Trending */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1 p-1 rounded-2xl bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336]">
                    <button
                      type="button"
                      onClick={() => setFeedMode('latest')}
                      className={`h-9 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
                        feedMode === 'latest'
                          ? 'bandhu-gradient text-white shadow-xs'
                          : 'text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Latest</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFeedMode('trending')}
                      className={`h-9 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
                        feedMode === 'trending'
                          ? 'bg-gradient-to-r from-pink-500 to-orange-500 text-white shadow-xs'
                          : 'text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      <Flame className="w-3.5 h-3.5" />
                      <span>Trending</span>
                    </button>
                  </div>
                  <span className="text-xs text-zinc-500 tabular-nums">
                    {visiblePosts.length} {visiblePosts.length === 1 ? 'post' : 'posts'}
                  </span>
                </div>

                {focusedPostId && (
                  <div className="bg-white dark:bg-[#14131D] border border-violet-500 rounded-2xl px-4 py-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-violet-600 dark:text-violet-400">
                      Viewing highlighted post
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setFocusedPostId(null);
                        window.history.replaceState({}, '', window.location.pathname);
                      }}
                      className="h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Back to Feed</span>
                    </button>
                  </div>
                )}

                {hashtagFilter && (
                  <div className="bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] rounded-2xl px-4 py-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-violet-600 dark:text-violet-400">
                      Showing posts tagged {hashtagFilter}
                    </span>
                    <button
                      type="button"
                      onClick={() => setHashtagFilter(null)}
                      className="h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Clear</span>
                    </button>
                  </div>
                )}

                {visiblePosts.length === 0 ? (
                  <div className="bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] rounded-3xl p-10 text-center space-y-3">
                    <p className="text-sm text-zinc-500">{t(lang, 'noPosts')}</p>
                    <button
                      type="button"
                      onClick={() => setComposerDefaultType('image')}
                      className="h-10 px-5 rounded-xl bandhu-gradient text-white text-xs font-semibold cursor-pointer"
                    >
                      {t(lang, 'createPost')}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {visiblePosts.map((post) => (
                      <PostCard
                        key={post.id}
                        post={post}
                        currentUser={currentUser}
                        authorPresence={presenceMap[post.authorId]}
                        authorVerified={verifiedUserIds.has(post.authorId)}
                        authorStats={speakingStatsMap[post.authorId] || null}
                        levelConfig={levelConfig}
                        isFollowingAuthor={followingIds.has(post.authorId)}
                        isSaved={savedIds.has(post.id)}
                        lang={lang}
                        onOpenComments={setCommentPost}
                        onSelectUser={openUserProfile}
                        onReportPost={(p) =>
                          setReportTarget({
                            type: 'post',
                            id: p.id,
                            ownerId: p.authorId,
                            label: `post by @${p.authorUsername}`,
                          })
                        }
                        onSelectHashtag={(tag) => setHashtagFilter(tag)}
                        onToast={showToast}
                      />
                    ))}

                    {!focusedPostId && posts.length >= feedLimit && (
                      <button
                        type="button"
                        onClick={() => setFeedLimit((n) => Math.min(120, n + 20))}
                        className="w-full h-11 rounded-2xl bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] text-xs font-semibold text-violet-600 dark:text-violet-400 hover:bg-violet-600 hover:text-white transition-colors cursor-pointer"
                      >
                        Load More Posts
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Right Discovery Sidebar */}
              <aside className="xl:col-span-4 space-y-4">
                <div className="bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] rounded-3xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-sm font-bold">Quick Search</h3>
                    <button
                      type="button"
                      onClick={() => setActiveTab('friends')}
                      className="text-xs font-semibold text-violet-600 dark:text-violet-400 cursor-pointer"
                    >
                      Open Directory
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('friends')}
                    className="w-full h-10 px-3.5 rounded-xl bg-[#F8F7FB] dark:bg-[#0B0B10] text-xs text-zinc-500 flex items-center gap-2 cursor-pointer"
                  >
                    <Search className="w-3.5 h-3.5 text-violet-500" />
                    <span className="truncate">{t(lang, 'searchPlaceholder')}</span>
                  </button>
                </div>

                {/* Trending Posts Highlight */}
                {trendingPreview.length > 0 && (
                  <div className="bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] rounded-3xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-sm font-bold flex items-center gap-1.5">
                        <Flame className="w-4 h-4 text-orange-500" />
                        <span>Trending Posts</span>
                      </h3>
                      <button
                        type="button"
                        onClick={() => setFeedMode('trending')}
                        className="text-xs font-semibold text-pink-600 dark:text-pink-400 cursor-pointer"
                      >
                        See Trending Feed
                      </button>
                    </div>
                    <div className="space-y-2.5">
                      {trendingPreview.map((tp, idx) => (
                        <button
                          key={tp.id}
                          type="button"
                          onClick={() => setFocusedPostId(tp.id)}
                          className="w-full text-left p-2.5 rounded-2xl bg-[#F8F7FB] dark:bg-[#0B0B10] hover:border-violet-400 border border-transparent transition-colors cursor-pointer space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                            <span className="font-bold text-violet-600 dark:text-violet-400 tabular-nums">
                              #{idx + 1} · {tp.authorName}
                            </span>
                            <span className="tabular-nums">
                              {tp.likesCount} likes · {tp.commentsCount} comments
                            </span>
                          </div>
                          <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200 line-clamp-2">
                            {tp.caption || (tp.mediaType === 'reel' ? 'Shared a reel video' : 'Shared a photo moment')}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] rounded-3xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-sm font-bold">Suggested Friends</h3>
                    <button
                      type="button"
                      onClick={() => setActiveTab('friends')}
                      className="text-xs font-semibold text-violet-600 dark:text-violet-400 cursor-pointer"
                    >
                      Discover
                    </button>
                  </div>
                  <div className="space-y-3">
                    {(suggestedFriends.length > 0
                      ? suggestedFriends
                      : allUsers.filter((u) => u.uid !== currentUser.uid && !blockedAll.has(u.uid))
                    )
                      .slice(0, 5)
                      .map((person) => {
                        const isFollowing = followingIds.has(person.uid);
                        const isOnline = Boolean(presenceMap[person.uid]?.isOnline);
                        return (
                          <div key={person.uid} className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => openUserProfile(person.uid)}
                              className="flex items-center gap-2.5 text-left min-w-0 cursor-pointer"
                            >
                              <div className="relative">
                                <Avatar src={person.photoURL} name={person.displayName} size="sm" />
                                {isOnline && (
                                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#14131D]" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-semibold truncate flex items-center gap-1">
                                  <span className="truncate">{person.displayName}</span>
                                  {person.isVerified && <VerifiedBadge className="w-3.5 h-3.5 shrink-0" />}
                                </p>
                                <p className="text-[11px] text-zinc-500 truncate">
                                  {person.location || `@${person.username}`}
                                </p>
                              </div>
                            </button>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => toggleFollowUser(currentUser, person.uid, isFollowing)}
                                className={`h-8 px-2.5 rounded-xl text-[11px] font-semibold cursor-pointer ${
                                  isFollowing
                                    ? 'border border-[#E7E3F0] dark:border-[#252336]'
                                    : 'bandhu-gradient text-white'
                                }`}
                              >
                                {isFollowing ? 'Following' : 'Follow'}
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  await sendFriendRequest(currentUser, person);
                                  showToast(`Friend request sent to ${person.displayName}`);
                                }}
                                aria-label={`Add ${person.displayName}`}
                                className="w-8 h-8 rounded-xl border border-[#E7E3F0] dark:border-[#252336] flex items-center justify-center cursor-pointer hover:border-violet-500"
                              >
                                <UserPlus className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>

                {trendingHashtags.length > 0 && (
                  <div className="bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] rounded-3xl p-5 space-y-3">
                    <h3 className="font-display text-sm font-bold">Trending Tags</h3>
                    <div className="flex flex-wrap gap-2">
                      {trendingHashtags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setHashtagFilter(tag)}
                          className="h-8 px-3 rounded-xl bg-[#F8F7FB] dark:bg-[#0B0B10] text-xs font-semibold text-violet-600 dark:text-violet-400 hover:bg-violet-600 hover:text-white transition-colors cursor-pointer"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] rounded-3xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-sm font-bold">Circles &amp; Events</h3>
                    <button
                      type="button"
                      onClick={() => setActiveTab('communities')}
                      className="text-xs font-semibold text-violet-600 dark:text-violet-400 cursor-pointer"
                    >
                      Explore All
                    </button>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Join interest groups, share local updates, and RSVP to upcoming community meetups.
                  </p>
                </div>
              </aside>
            </div>
          )}

          <Suspense
            fallback={
              activeTab !== 'home' ? (
                <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-10 text-center text-sm text-zinc-500 animate-pulse">
                  Loading workspace...
                </div>
              ) : null
            }
          >
            {activeTab === 'friends' && (
              <FriendsView
                currentUser={currentUser}
                allUsers={allUsers}
                allPosts={posts}
                presenceMap={presenceMap}
                followingIds={followingIds}
                friendRequests={friendRequests}
                blockedIds={blockedAll}
                lang={lang}
                onOpenChatWith={(uid) => {
                  setChatPeerUid(uid);
                  setActiveTab('chat');
                }}
                onStartCall={handleStartCall}
                onSelectUser={openUserProfile}
                onSelectHashtag={(tag) => {
                  setHashtagFilter(tag);
                  setActiveTab('home');
                }}
                onOpenReels={() => setActiveTab('reels')}
                onToast={showToast}
              />
            )}

            {activeTab === 'reels' && (
              <ReelsView
                reels={reels}
                currentUser={currentUser}
                followingIds={followingIds}
                savedIds={savedIds}
                verifiedUserIds={verifiedUserIds}
                allowVideoReels={appSettings.allowVideoReels}
                lang={lang}
                onOpenComments={setCommentPost}
                onOpenCreateReel={() => setComposerDefaultType('reel')}
                onSelectUser={openUserProfile}
                onToast={showToast}
              />
            )}

            {activeTab === 'audio' && (
              <AudioPartyView
                currentUser={currentUser}
                wallet={wallet}
                verifiedUserIds={verifiedUserIds}
                blockedIds={blockedAll}
                allowAudioRooms={appSettings.allowAudioRooms !== false}
                allowVirtualGifts={appSettings.allowVirtualGifts !== false}
                initialRoomId={audioRoomFocusId}
                levelConfig={levelConfig}
                speakingStatsMap={speakingStatsMap}
                lang={lang}
                onOpenWallet={() => setWalletOpen(true)}
                onSelectUser={openUserProfile}
                onToast={showToast}
              />
            )}

            {activeTab === 'live' && (
              <LiveStreamView
                currentUser={currentUser}
                liveStreams={liveStreams.filter((l) => !blockedAll.has(l.hostId))}
                followerOrFriendUids={Array.from(followingIds)}
                allowLiveStreaming={appSettings.allowLiveStreaming}
                initialStreamId={liveStreamFocusId}
                lang={lang}
                onToast={showToast}
              />
            )}

            {activeTab === 'chat' && (
              <ChatView
                currentUser={currentUser}
                allUsers={allUsers}
                presenceMap={presenceMap}
                conversations={conversations}
                blockedIds={blockedAll}
                initialPeerId={chatPeerUid}
                lang={lang}
                onStartCall={handleStartCall}
                onSelectUser={openUserProfile}
                onToast={showToast}
              />
            )}

            {activeTab === 'communities' && (
              <CommunitiesEventsView
                currentUser={currentUser}
                lang={lang}
                onToast={showToast}
              />
            )}

            {activeTab === 'notifications' && (
              <NotificationsView
                notifications={notifications}
                lang={lang}
                onNavigateFromNotification={(item) => {
                  if (item.type === 'message') setActiveTab('chat');
                  else if (item.type === 'live') {
                    setLiveStreamFocusId(item.postId || null);
                    setActiveTab('live');
                  } else if (item.type === 'friend_request' || item.type === 'friend_accept') {
                    setActiveTab('friends');
                  } else {
                    openUserProfile(item.actorId);
                  }
                }}
              />
            )}

            {activeTab === 'profile' && (
              <ProfileView
                profile={profileTarget}
                currentUser={currentUser}
                presence={presenceMap[profileTarget.uid]}
                posts={posts.filter((p) => !blockedAll.has(p.authorId))}
                savedPosts={savedPosts}
                followingIds={followingIds}
                savedIds={savedIds}
                levelConfig={levelConfig}
                speakingStats={speakingStatsMap[profileTarget.uid] || null}
                lang={lang}
                isOriginalOwner={isOriginalOwner}
                verifiedOwnerUid={verifiedOwnerUid}
                ownerBackendVerified={ownerBackendVerified}
                onOpenOwnerDashboard={() => setActiveTab('moderation')}
                onProfileUpdated={(next) => {
                  if (next.uid === currentUser.uid) setCurrentUser(next);
                }}
                onOpenComments={setCommentPost}
                onOpenChatWith={(uid) => {
                  setChatPeerUid(uid);
                  setActiveTab('chat');
                }}
                onStartCall={handleStartCall}
                onSelectUser={openUserProfile}
                onSelectHashtag={(tag) => {
                  setHashtagFilter(tag);
                  setActiveTab('home');
                }}
                onReportUserOrPost={setReportTarget}
                onOpenPrivacy={() => setActiveTab('privacy')}
                onToast={showToast}
              />
            )}

            {activeTab === 'privacy' && (
              <PrivacyHelpLegalView
                currentUser={currentUser}
                allUsers={allUsers}
                blockedByMe={blockedByMe}
                lang={lang}
                onProfileUpdated={setCurrentUser}
                onToast={showToast}
              />
            )}

            {activeTab === 'moderation' && (isOriginalOwner || isAdmin) && (
              <OwnerAdminView
                currentUser={currentUser}
                isOriginalOwner={isOriginalOwner}
                hasAdminAccess={isOriginalOwner || isAdmin}
                ownerUid={verifiedOwnerUid}
                ownerBackendVerified={ownerBackendVerified}
                liveStreams={liveStreams}
                appSettings={appSettings}
                levelConfig={levelConfig}
                speakingStatsMap={speakingStatsMap}
                onToast={showToast}
              />
            )}
          </Suspense>
        </main>
      </div>

      {/* Mobile Fixed Bottom Thumb Navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 dark:bg-[#14131D]/95 backdrop-blur-md border-t border-[#E7E3F0] dark:border-[#252336] grid grid-cols-5 items-center">
        {mobileBottomItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.id === 'profile') setSelectedProfileUid(currentUser.uid);
                setActiveTab(item.id);
              }}
              className={`h-full flex flex-col items-center justify-center gap-0.5 relative cursor-pointer transition-colors ${
                active ? 'text-violet-600 dark:text-violet-400' : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bandhu-gradient text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                    {item.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-semibold tracking-tight truncate max-w-[64px]">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Modals & Call Overlay */}
      {composerDefaultType && (
        <CreatePostModal
          currentUser={currentUser}
          defaultType={composerDefaultType}
          onClose={() => setComposerDefaultType(null)}
          onCreated={() => showToast('Published to BANDHU MELA')}
        />
      )}

      {commentPost && (
        <CommentsModal
          post={commentPost}
          currentUser={currentUser}
          onClose={() => setCommentPost(null)}
          onSelectUser={openUserProfile}
        />
      )}

      {reportTarget && (
        <ReportModal
          reporter={currentUser}
          targetType={reportTarget.type}
          targetId={reportTarget.id}
          targetOwnerId={reportTarget.ownerId}
          targetLabel={reportTarget.label}
          onClose={() => setReportTarget(null)}
          onSubmitted={() => showToast('Report submitted to BANDHU MELA moderators')}
        />
      )}

      {activeCall && (
        <Suspense fallback={null}>
          <CallOverlay
            call={activeCall}
            currentUser={currentUser}
            onClose={() => setActiveCall(null)}
            onToast={showToast}
          />
        </Suspense>
      )}

      {walletOpen && (
        <Suspense fallback={null}>
          <WalletModal
            currentUser={currentUser}
            wallet={wallet}
            allowCoinPurchases={appSettings.allowCoinPurchases}
            onClose={() => setWalletOpen(false)}
            onToast={showToast}
          />
        </Suspense>
      )}

      {toastMsg && (
        <div className="fixed bottom-20 lg:bottom-6 right-4 lg:right-6 z-50 bg-zinc-950 dark:bg-white text-white dark:text-zinc-950 px-4 py-3 rounded-2xl text-xs font-semibold shadow-xl">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
