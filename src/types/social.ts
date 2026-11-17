export type MediaType = 'text' | 'image' | 'video' | 'reel';
export type AspectRatio = '1:1' | '4:3' | '9:16' | '16:9';
export type LanguageCode = 'en' | 'bn';

export interface UserProfile {
  uid: string;
  username: string;
  displayName: string;
  bio: string;
  location: string;
  workOrBioTag: string;
  photoURL: string;
  coverURL: string;
  profileVisibility: 'public' | 'friends';
  messagePrivacy: 'everyone' | 'friends';
  showOnlineStatus: boolean;
  isVerified: boolean;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  isSuspended: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserPrivateInfo {
  uid: string;
  email: string;
  phoneNumber: string;
  role: 'user' | 'admin';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserPresence {
  uid: string;
  isOnline: boolean;
  lastSeen?: unknown;
  updatedAt?: unknown;
}

export interface Post {
  id: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorPhoto: string;
  caption: string;
  hashtags: string[];
  mediaUrl: string;
  mediaType: MediaType;
  aspectRatio: AspectRatio;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  status: 'active' | 'hidden';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StoryItem {
  id: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorPhoto: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  caption: string;
  viewersCount: number;
  createdAt?: unknown;
  expiresAt?: unknown;
}

export interface PostComment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorPhoto: string;
  text: string;
  createdAt?: unknown;
}

export interface FollowRecord {
  followerId: string;
  followingId: string;
  createdAt?: unknown;
}

export interface FriendRequest {
  id: string;
  senderId: string;
  senderName: string;
  senderUsername: string;
  senderPhoto: string;
  receiverId: string;
  receiverName: string;
  receiverUsername: string;
  receiverPhoto: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Conversation {
  id: string;
  isGroup: boolean;
  groupName: string;
  groupPhoto: string;
  createdBy: string;
  participantA: string;
  participantB: string;
  participants: string[];
  participantAName: string;
  participantAPhoto: string;
  participantBName: string;
  participantBPhoto: string;
  lastMessage: string;
  lastSenderId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderPhoto: string;
  participants: string[];
  text: string;
  mediaUrl: string;
  createdAt?: unknown;
}

export interface LiveStream {
  id: string;
  hostId: string;
  hostName: string;
  hostUsername: string;
  hostPhoto: string;
  title: string;
  status: 'live' | 'ended';
  viewersCount: number;
  reactionsCount: number;
  startedAt?: unknown;
  updatedAt?: unknown;
}

export interface LiveComment {
  id: string;
  streamId: string;
  authorId: string;
  authorName: string;
  authorPhoto: string;
  text: string;
  kind: 'comment' | 'reaction';
  createdAt?: unknown;
}

export interface WebRTCSignal {
  id: string;
  streamId: string;
  fromUid: string;
  toUid: string;
  type: 'offer' | 'answer' | 'ice';
  payload: string;
  createdAt?: unknown;
}

export interface CallSession {
  id: string;
  callerId: string;
  callerName: string;
  callerPhoto: string;
  calleeId: string;
  calleeName: string;
  calleePhoto: string;
  participants: string[];
  callType: 'audio' | 'video';
  status: 'ringing' | 'active' | 'ended' | 'declined' | 'missed';
  offerSdp: string;
  answerSdp: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface NotificationItem {
  id: string;
  recipientId: string;
  actorId: string;
  actorName: string;
  actorPhoto: string;
  type: 'like' | 'comment' | 'follow' | 'friend_request' | 'friend_accept' | 'message' | 'live' | 'call' | 'system';
  postId: string;
  message: string;
  read: boolean;
  createdAt?: unknown;
}

export interface BlockRecord {
  blockerId: string;
  blockedId: string;
  createdAt?: unknown;
}

export interface ModerationReport {
  id: string;
  reporterId: string;
  reporterUsername: string;
  targetType: 'post' | 'user' | 'comment';
  targetId: string;
  targetOwnerId: string;
  reason: string;
  details: string;
  status: 'open' | 'reviewed' | 'resolved' | 'dismissed';
  adminNotes: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Announcement {
  id: string;
  title: string;
  message: string;
  priority: 'normal' | 'important';
  authorId: string;
  authorName: string;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AppSettings {
  id: string;
  maintenanceMode: boolean;
  allowNewRegistrations: boolean;
  allowLiveStreaming: boolean;
  allowVideoReels: boolean;
  allowAudioRooms?: boolean;
  allowVirtualGifts?: boolean;
  allowCoinPurchases?: boolean;
  ownerUid?: string;
  welcomeHeadline: string;
  updatedBy: string;
  updatedAt?: unknown;
}

export interface AdminRecord {
  uid: string;
  grantedBy: string;
  role?: 'admin' | 'moderator';
  isSuspended?: boolean;
  displayName?: string;
  email?: string;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SupportTicket {
  id: string;
  userId: string;
  username: string;
  category: string;
  subject: string;
  message: string;
  status: 'open' | 'in_review' | 'resolved';
  adminReply: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Community {
  id: string;
  name: string;
  description: string;
  category: string;
  coverUrl: string;
  creatorId: string;
  creatorName: string;
  membersCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CommunityMember {
  userId: string;
  communityId: string;
  displayName: string;
  photoURL: string;
  role: 'admin' | 'member';
  joinedAt?: unknown;
}

export interface CommunityPost {
  id: string;
  communityId: string;
  authorId: string;
  authorName: string;
  authorPhoto: string;
  text: string;
  mediaUrl: string;
  createdAt?: unknown;
}

export interface SocialEvent {
  id: string;
  title: string;
  description: string;
  location: string;
  eventDate: string;
  coverUrl: string;
  hostId: string;
  hostName: string;
  attendeesCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface EventRsvp {
  userId: string;
  eventId: string;
  displayName: string;
  status: 'going' | 'interested';
  updatedAt?: unknown;
}

export interface AudioRoom {
  id: string;
  title: string;
  topic: string;
  visibility: 'public' | 'private';
  vipOnly?: boolean;
  passcodeHash: string;
  hostId: string;
  hostName: string;
  hostUsername: string;
  hostPhoto: string;
  moderatorIds: string[];
  speakerIds: string[];
  status: 'live' | 'ended';
  participantsCount: number;
  giftsCoinsTotal: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AudioRoomParticipant {
  userId: string;
  roomId: string;
  displayName: string;
  username: string;
  photoURL: string;
  role: 'host' | 'moderator' | 'speaker' | 'listener';
  seatNumber: number; // 1..5 for speakers, 0 for listener
  isMuted: boolean;
  handRaised: boolean;
  invitedToSpeak: boolean;
  isBanned: boolean;
  joinedAt?: unknown;
  updatedAt?: unknown;
}

export interface AudioRoomMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  senderPhoto: string;
  kind: 'chat' | 'reaction' | 'gift' | 'system' | 'vip_entry';
  text: string;
  giftId: string;
  giftName: string;
  giftEmoji: string;
  recipientName: string;
  createdAt?: unknown;
}

export interface VirtualGift {
  id: string;
  name: string;
  emoji: string;
  category: 'classic' | 'royal' | 'celebration';
  coinPrice: number;
  animationType: 'float' | 'burst' | 'crown' | 'sparkle' | 'couple_love';
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CoinPackage {
  id: string;
  name: string;
  coins: number;
  bonusCoins: number;
  priceUsd: number;
  priceInr: number;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserWallet {
  uid: string;
  coinsBalance: number;
  earnedBeans: number;
  totalSpent: number;
  totalPurchased: number;
  totalPromotionalEarned?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CoinTransaction {
  id: string;
  userId: string;
  counterpartyId: string;
  counterpartyName: string;
  type:
    | 'starter'
    | 'purchase'
    | 'gift_sent'
    | 'gift_received'
    | 'owner_adjustment'
    | 'daily_bonus'
    | 'weekly_bonus'
    | 'monthly_bonus'
    | 'speaking_reward'
    | 'hosting_reward'
    | 'promo_bonus';
  coinsDelta: number;
  note: string;
  referenceId: string;
  coinSource?: 'purchased' | 'promotional' | 'earned' | 'spend';
  createdAt?: unknown;
}

export interface CoinEconomyConfig {
  id: 'coinEconomy';
  dailyBonusEnabled: boolean;
  dailyBonusCoins: number;
  weeklyBonusEnabled: boolean;
  weeklyBonusCoins: number;
  weeklyBonusWeekdayUtc: number; // -1 = any day, 0..6 = Sun..Sat
  weeklyMinSpeakingMinutes: number;
  monthlyBonusEnabled: boolean;
  monthlyBonusCoins: number;
  monthlyBonusDayOfMonth: number; // 1..28
  monthlyMinSpeakingMinutes: number;
  monthlyMinLevel: number; // 0..5
  speakingRewardEnabled: boolean;
  speakingMinutesPerReward: number;
  speakingRewardCoins: number;
  speakingDailyMaxCoins: number;
  hostingBonusEnabled: boolean;
  hostingRateMode: 'per_minute' | 'per_hour';
  hostingCoinsPerUnit: number;
  hostingMinListeners: number;
  hostingDailyMaxCoins: number;
  hostingMonthlyMaxCoins: number;
  updatedBy: string;
  updatedAt?: unknown;
}

export interface PromotionalPool {
  id: 'main';
  issuedBudget: number;
  distributedCoins: number;
  remainingBudget: number;
  paused: boolean;
  perUserDailyCap: number;
  perUserMonthlyCap: number;
  maxSingleReward: number;
  updatedBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PromotionalLedgerEntry {
  id: string;
  entryType:
    | 'budget_issued'
    | 'daily_bonus'
    | 'weekly_bonus'
    | 'monthly_bonus'
    | 'speaking_reward'
    | 'hosting_reward'
    | 'owner_promo_grant'
    | 'pool_status_change';
  userId: string;
  username: string;
  coinsDelta: number;
  budgetImpact: number;
  remainingAfter: number;
  note: string;
  actorUid: string;
  referenceId: string;
  createdAt?: unknown;
}

export interface EconomyRewardClaim {
  id: string;
  userId: string;
  bonusType: 'daily' | 'weekly' | 'monthly';
  periodKey: string;
  coinsAwarded: number;
  transactionId: string;
  createdAt?: unknown;
}

export interface UserEconomyProgress {
  uid: string;
  dayKey: string;
  monthKey: string;
  dailyPromoCoinsEarned: number;
  monthlyPromoCoinsEarned: number;
  speakingCarrySeconds: number;
  speakingDailyCoinsEarned: number;
  hostingCarrySeconds: number;
  hostingDailyCoinsEarned: number;
  hostingMonthlyCoinsEarned: number;
  lastSpeakingRewardAtMs: number;
  lastHostingRewardAtMs: number;
  lastRoomId: string;
  updatedAt?: unknown;
}

export interface EconomyUserStatus {
  config: CoinEconomyConfig;
  pool: {
    paused: boolean;
    remainingBudget: number;
    perUserDailyCap: number;
    perUserMonthlyCap: number;
  };
  progress: UserEconomyProgress;
  claims: {
    daily: { periodKey: string; claimed: boolean; eligible: boolean; reason: string; amount: number };
    weekly: { periodKey: string; claimed: boolean; eligible: boolean; reason: string; amount: number };
    monthly: { periodKey: string; claimed: boolean; eligible: boolean; reason: string; amount: number };
  };
  gateway: {
    stripeEnabled: boolean;
    razorpayEnabled: boolean;
    ownerApprovalEnabled: boolean;
  };
}

export interface GiftEvent {
  id: string;
  roomId: string;
  roomTitle: string;
  senderId: string;
  senderName: string;
  senderPhoto: string;
  recipientId: string;
  recipientName: string;
  giftId: string;
  giftName: string;
  giftEmoji: string;
  coinsCost: number;
  transactionId?: string;
  animationType?: VirtualGift['animationType'];
  createdAt?: unknown;
}

export interface CoinTopupRequest {
  id: string;
  userId: string;
  username: string;
  packageId: string;
  packageName: string;
  coins: number;
  amountLabel: string;
  paymentProvider: 'owner_approval' | 'razorpay' | 'stripe' | 'google_play';
  paymentRef: string;
  status: 'pending' | 'approved' | 'rejected';
  adminNote: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: 'owner' | 'admin' | 'moderator';
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  createdAt?: unknown;
}

export interface LevelTier {
  level: number;
  name: string;
  minHours: number;
  badgeColor: string;
  badgeEmoji: string;
}

export interface LevelConfig {
  id: 'levelConfig';
  levels: LevelTier[];
  enableVipFrames: boolean;
  enableVipNameColors: boolean;
  enableVipExclusiveEmojis: boolean;
  enableVipRoomAccess: boolean;
  enableVipEntryAnimation: boolean;
  vipBadgeColor?: string;
  updatedBy: string;
  updatedAt?: unknown;
}

export interface SpeakingStats {
  uid: string;
  monthKey: string;
  cycleEndsAt: number;
  monthlySeconds: number;
  lifetimeSeconds: number;
  lastRoomId: string;
  lastHeartbeatAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SpeakingMonthHistory {
  uid: string;
  monthKey: string;
  speakingSeconds: number;
  achievedLevel: number;
  levelName: string;
  wasVip: boolean;
  archivedAt?: unknown;
}

export type AppTab =
  | 'home'
  | 'friends'
  | 'reels'
  | 'audio'
  | 'live'
  | 'chat'
  | 'communities'
  | 'notifications'
  | 'profile'
  | 'privacy'
  | 'moderation';
