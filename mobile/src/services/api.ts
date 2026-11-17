import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteUser, User } from 'firebase/auth';
import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { auth, db, ORIGINAL_OWNER_UID, OWNER_ADMIN_EMAIL, SERVER_API_BASE, storage } from '../config/firebase';
import {
  AdminRecord,
  Announcement,
  AppSettings,
  AspectRatio,
  AudioRoom,
  AudioRoomMessage,
  AudioRoomParticipant,
  AuditLogEntry,
  ChatMessage,
  CoinPackage,
  CoinTopupRequest,
  CoinTransaction,
  CommunityEvent,
  CommunityGroup,
  CommunityMember,
  Conversation,
  EventRsvp,
  FollowRecord,
  FriendRequest,
  GiftEvent,
  LevelConfig,
  LevelTier,
  LiveComment,
  LiveStream,
  MediaType,
  ModerationReport,
  NotificationItem,
  Post,
  PostComment,
  SpeakingMonthHistory,
  SpeakingStats,
  StoryItem,
  SupportTicket,
  UserPresence,
  UserPrivateInfo,
  UserProfile,
  UserWallet,
  VirtualGift,
} from '../types/social';

// ---------- Pure Time, ID & Formatting Helpers ----------
export function toMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'object' && ts !== null && 'toMillis' in ts && typeof (ts as { toMillis: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  if (ts instanceof Date) return ts.getTime();
  return 0;
}

export function formatRelativeTime(ts: unknown): string {
  const ms = toMillis(ts);
  if (!ms) return 'Just now';
  const diff = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function makeId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function makePairId(uidA: string, uidB: string): string {
  return uidA < uidB ? `${uidA}_${uidB}` : `${uidB}_${uidA}`;
}

export function sanitizeUsername(raw: string, fallbackUid: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  if (cleaned.length >= 3) return cleaned;
  return `bandhu_${fallbackUid.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'user'}`;
}

export function extractHashtags(text: string): string[] {
  const matches = text.match(/#[a-zA-Z0-9_\u0980-\u09FF]+/g) || [];
  return Array.from(new Set(matches.map((m) => m.toLowerCase().slice(0, 40)))).slice(0, 15);
}

export async function hashRoomPasscode(roomId: string, passcode: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${roomId}:${passcode.trim()}`);
}

export type UploadFolder = 'avatars' | 'covers' | 'posts' | 'stories' | 'reels' | 'chats';

export function resolveMediaUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('/uploads/')) {
    return `${SERVER_API_BASE.replace(/\/$/, '')}${url}`;
  }
  return url;
}

const MAX_MOBILE_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_MOBILE_VIDEO_BYTES = 25 * 1024 * 1024;
let mobileBucketCache: { bucket: string; available: boolean; checkedAt: number } | null = null;

async function isMobileStorageBucketAvailable(): Promise<boolean> {
  const bucket = String(storage.app.options.storageBucket || '');
  if (!bucket) return false;
  const now = Date.now();
  if (mobileBucketCache && mobileBucketCache.bucket === bucket && now - mobileBucketCache.checkedAt < 60_000) {
    return mobileBucketCache.available;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?maxResults=1`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    const available = resp.status !== 404;
    mobileBucketCache = { bucket, available, checkedAt: now };
    return available;
  } catch {
    return false;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected media file on device.'));
    reader.readAsDataURL(blob);
  });
}

function uploadMobileToServerWithProgress(
  base64: string,
  mimeType: string,
  folder: UploadFolder,
  idToken: string,
  onProgress?: (pct: number, stage: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const endpoint = `${SERVER_API_BASE.replace(/\/$/, '')}/api/upload`;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint, true);
    xhr.timeout = mimeType.startsWith('video/') ? 90_000 : 35_000;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        const pct = Math.min(94, Math.max(10, Math.round((evt.loaded / evt.total) * 90)));
        onProgress?.(pct, `Uploading media (${pct}%)...`);
      }
    };

    xhr.onload = () => {
      let parsed: { url?: string; error?: string; verified?: boolean } = {};
      try {
        parsed = JSON.parse(xhr.responseText || '{}') as { url?: string; error?: string; verified?: boolean };
      } catch {
        // ignore
      }
      if (xhr.status >= 200 && xhr.status < 300 && parsed.url && parsed.verified) {
        resolve(parsed.url);
      } else {
        reject(new Error(parsed.error || `Upload failed on media server (HTTP ${xhr.status}).`));
      }
    };

    xhr.onerror = () =>
      reject(
        new Error(
          `Cannot reach BANDHU MELA media server at ${SERVER_API_BASE}. Check internet or set EXPO_PUBLIC_API_URL.`
        )
      );
    xhr.ontimeout = () => reject(new Error('Upload timed out. Try a smaller file or check your connection.'));
    xhr.send(JSON.stringify({ mimeType, base64, folder }));
  });
}

async function verifyMobileMediaAccessible(rawUrl: string): Promise<void> {
  const target = resolveMediaUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(target, { method: 'HEAD', signal: controller.signal });
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (resp.ok && !ct.includes('text/html')) return;
    if (resp.status === 405) {
      const rangeResp = await fetch(target, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        signal: controller.signal,
      });
      const rct = (rangeResp.headers.get('content-type') || '').toLowerCase();
      if ((rangeResp.status === 200 || rangeResp.status === 206) && !rct.includes('text/html')) return;
    }
    throw new Error(`Uploaded file could not be verified (HTTP ${resp.status}).`);
  } finally {
    clearTimeout(timer);
  }
}

export async function compressAndUploadMedia(
  uri: string,
  folderInput: string,
  kind: 'image' | 'video',
  onProgress?: (progressPct: number, stage: string) => void
): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Please sign in again before uploading media.');
  }

  const rawTop = folderInput.trim().toLowerCase().split('/')[0];
  const folder: UploadFolder =
    rawTop === 'avatars' ||
    rawTop === 'covers' ||
    rawTop === 'posts' ||
    rawTop === 'stories' ||
    rawTop === 'reels' ||
    rawTop === 'chats'
      ? rawTop
      : rawTop === 'profiles'
        ? 'avatars'
        : 'posts';

  onProgress?.(4, 'Preparing media...');
  let finalUri = uri;
  const ext = kind === 'video' ? 'mp4' : 'jpg';
  const contentType = kind === 'video' ? 'video/mp4' : 'image/jpeg';

  if (kind === 'image') {
    const targetWidth = folder === 'avatars' ? 512 : folder === 'covers' ? 1440 : 1280;
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: targetWidth } }],
      { compress: 0.78, format: ImageManipulator.SaveFormat.JPEG }
    );
    finalUri = manipulated.uri;
  }

  const resp = await fetch(finalUri);
  const blob = await resp.blob();
  const limitBytes = kind === 'video' ? MAX_MOBILE_VIDEO_BYTES : MAX_MOBILE_IMAGE_BYTES;
  if (blob.size <= 0) {
    throw new Error('Selected file appears empty or unreadable.');
  }
  if (blob.size > limitBytes) {
    throw new Error(`Selected ${kind} exceeds ${Math.round(limitBytes / (1024 * 1024))}MB limit.`);
  }

  const idToken = await user.getIdToken();
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const storagePath = `${folder}/${user.uid}/${fileName}`;
  let uploadedUrl = '';

  const storageAvailable = await isMobileStorageBucketAvailable();
  if (storageAvailable) {
    try {
      uploadedUrl = await new Promise<string>((resolve, reject) => {
        const storageRef = ref(storage, storagePath);
        const task = uploadBytesResumable(storageRef, blob, { contentType });
        const timer = setTimeout(() => {
          try {
            task.cancel();
          } catch {
            // ignore
          }
          reject(new Error('STORAGE_TIMEOUT'));
        }, 8000);

        task.on(
          'state_changed',
          (snap) => {
            if (snap.totalBytes > 0) {
              const pct = Math.min(92, Math.max(8, Math.round((snap.bytesTransferred / snap.totalBytes) * 90)));
              onProgress?.(pct, `Uploading to cloud storage (${pct}%)...`);
            }
          },
          (err) => {
            clearTimeout(timer);
            reject(err);
          },
          async () => {
            clearTimeout(timer);
            try {
              resolve(await getDownloadURL(task.snapshot.ref));
            } catch (err) {
              reject(err);
            }
          }
        );
      });
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
        throw new Error('Upload denied. Please make sure your email address is verified.');
      }
      mobileBucketCache = {
        bucket: String(storage.app.options.storageBucket || ''),
        available: false,
        checkedAt: Date.now(),
      };
    }
  }

  if (!uploadedUrl) {
    onProgress?.(8, 'Uploading via secure BANDHU MELA media server...');
    const dataUrl = await blobToDataUrl(blob);
    uploadedUrl = await uploadMobileToServerWithProgress(dataUrl, contentType, folder, idToken, onProgress);
  }

  onProgress?.(96, 'Verifying stored file...');
  await verifyMobileMediaAccessible(uploadedUrl);
  onProgress?.(100, 'Upload verified');

  return uploadedUrl;
}

// ---------- Defaults ----------
export const DEFAULT_APP_SETTINGS: AppSettings = {
  id: 'platform',
  maintenanceMode: false,
  allowNewRegistrations: true,
  allowLiveStreaming: true,
  allowVideoReels: true,
  allowAudioRooms: true,
  allowVirtualGifts: true,
  allowCoinPurchases: true,
  ownerUid: '',
  welcomeHeadline: 'Connect • Share • Chat • Make Friends',
  updatedBy: 'system',
};

export const DEFAULT_VIRTUAL_GIFTS: VirtualGift[] = [
  { id: 'gift_rose', name: 'Bengal Rose', emoji: '🌹', category: 'classic', coinPrice: 10, animationType: 'float', active: true },
  { id: 'gift_chai', name: 'Kulhad Chai', emoji: '🍵', category: 'classic', coinPrice: 15, animationType: 'float', active: true },
  { id: 'gift_heart', name: 'Warm Heart', emoji: '💖', category: 'classic', coinPrice: 25, animationType: 'burst', active: true },
  { id: 'gift_teddy', name: 'Teddy Hug', emoji: '🧸', category: 'celebration', coinPrice: 60, animationType: 'burst', active: true },
  { id: 'gift_diya', name: 'Festive Diya', emoji: '🪔', category: 'celebration', coinPrice: 100, animationType: 'sparkle', active: true },
  { id: 'gift_crown', name: 'Royal Crown', emoji: '👑', category: 'royal', coinPrice: 250, animationType: 'crown', active: true },
  { id: 'gift_diamond', name: 'Star Diamond', emoji: '💎', category: 'royal', coinPrice: 500, animationType: 'sparkle', active: true },
  { id: 'gift_love_couple', name: 'Love Couple Gift', emoji: '❤️', category: 'royal', coinPrice: 500, animationType: 'couple_love', active: true },
];

export const LEGACY_COIN_PACKAGE_IDS = ['pkg_starter', 'pkg_festive', 'pkg_royal', 'pkg_legend'] as const;

export const DEFAULT_COIN_PACKAGES: CoinPackage[] = [
  { id: 'pkg_100', name: '100 Coins Pack', coins: 100, bonusCoins: 0, priceUsd: 0.12, priceInr: 10, active: true },
  { id: 'pkg_500', name: '500 Coins Pack', coins: 500, bonusCoins: 0, priceUsd: 0.59, priceInr: 49, active: true },
  { id: 'pkg_1000', name: '1,000 Coins Pack', coins: 1000, bonusCoins: 0, priceUsd: 1.19, priceInr: 99, active: true },
  { id: 'pkg_5000', name: '5,000 Coins Pack', coins: 5000, bonusCoins: 0, priceUsd: 4.79, priceInr: 399, active: true },
  { id: 'pkg_10000', name: '10,000 Coins Pack', coins: 10000, bonusCoins: 0, priceUsd: 9.59, priceInr: 799, active: true },
];

// ---------- Monthly Level & VIP System ----------
export const DEFAULT_LEVEL_TIERS: LevelTier[] = [
  { level: 1, name: 'Beginner', minHours: 1, badgeColor: '#10B981', badgeEmoji: '🌱' },
  { level: 2, name: 'Silver', minHours: 5, badgeColor: '#64748B', badgeEmoji: '🥈' },
  { level: 3, name: 'Gold', minHours: 15, badgeColor: '#F59E0B', badgeEmoji: '🥇' },
  { level: 4, name: 'Diamond', minHours: 30, badgeColor: '#06B6D4', badgeEmoji: '💎' },
  { level: 5, name: 'VIP', minHours: 100, badgeColor: '#D97706', badgeEmoji: '👑' },
];

export const DEFAULT_LEVEL_CONFIG: LevelConfig = {
  id: 'levelConfig',
  levels: DEFAULT_LEVEL_TIERS,
  enableVipFrames: true,
  enableVipNameColors: true,
  enableVipExclusiveEmojis: true,
  enableVipRoomAccess: true,
  enableVipEntryAnimation: true,
  vipBadgeColor: '#F59E0B',
  updatedBy: 'system',
};

export const VIP_EXCLUSIVE_EMOJIS = ['👑', '💎', '🦚', '✨', '🪔', '🏆', '🔱', '🌟'];

export function getCurrentMonthKey(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function getCycleEndMillis(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0) - 1;
}

export function getMonthlyResetCountdown(now = new Date()): { days: number; hours: number; resetLabel: string } {
  const nextFirst = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0);
  const diffMs = Math.max(0, nextFirst - now.getTime());
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  const resetDate = new Date(nextFirst);
  return {
    days,
    hours,
    resetLabel: resetDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  };
}

export function computeLevelSummary(
  stats: SpeakingStats | null | undefined,
  config: LevelConfig = DEFAULT_LEVEL_CONFIG
): {
  activeSeconds: number;
  activeHours: number;
  currentLevel: number;
  currentTier: LevelTier | null;
  nextTier: LevelTier | null;
  progressPct: number;
  remainingSeconds: number;
  remainingLabel: string;
  isVip: boolean;
} {
  const currentMonth = getCurrentMonthKey();
  const nowMs = Date.now();
  const sameMonth = Boolean(stats && stats.monthKey === currentMonth && stats.cycleEndsAt > nowMs);
  const activeSeconds = sameMonth ? Math.max(0, stats?.monthlySeconds || 0) : 0;
  const activeHours = activeSeconds / 3600;

  const tiers = [...(config.levels?.length === 5 ? config.levels : DEFAULT_LEVEL_TIERS)].sort(
    (a, b) => a.level - b.level
  );

  let currentTier: LevelTier | null = null;
  let nextTier: LevelTier | null = tiers[0];

  for (let i = 0; i < tiers.length; i++) {
    const reqSec = Math.max(1, tiers[i].minHours) * 3600;
    if (activeSeconds >= reqSec) {
      currentTier = tiers[i];
      nextTier = tiers[i + 1] || null;
    } else {
      nextTier = tiers[i];
      break;
    }
  }

  let progressPct = 100;
  let remainingSeconds = 0;
  if (nextTier) {
    const prevSec = currentTier ? currentTier.minHours * 3600 : 0;
    const targetSec = nextTier.minHours * 3600;
    const span = Math.max(1, targetSec - prevSec);
    progressPct = Math.min(100, Math.max(0, Math.round(((activeSeconds - prevSec) / span) * 100)));
    remainingSeconds = Math.max(0, targetSec - activeSeconds);
  }

  const remHrs = Math.floor(remainingSeconds / 3600);
  const remMins = Math.ceil((remainingSeconds % 3600) / 60);
  const remainingLabel = nextTier
    ? remHrs > 0
      ? `${remHrs}h ${remMins}m to ${nextTier.name}`
      : `${remMins}m to ${nextTier.name}`
    : 'Max VIP Tier Unlocked';

  return {
    activeSeconds,
    activeHours,
    currentLevel: currentTier?.level || 0,
    currentTier,
    nextTier,
    progressPct,
    remainingSeconds,
    remainingLabel,
    isVip: (currentTier?.level || 0) >= 5 && sameMonth,
  };
}

export function formatSpeakingDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

export function subscribeLevelConfig(onData: (config: LevelConfig) => void): () => void {
  return onSnapshot(
    doc(db, 'appSettings', 'levelConfig'),
    (snap) => {
      if (!snap.exists()) {
        onData(DEFAULT_LEVEL_CONFIG);
        return;
      }
      const data = snap.data() as Partial<LevelConfig>;
      onData({
        ...DEFAULT_LEVEL_CONFIG,
        ...data,
        levels: data.levels?.length === 5 ? data.levels : DEFAULT_LEVEL_TIERS,
      });
    },
    () => onData(DEFAULT_LEVEL_CONFIG)
  );
}

export async function saveLevelConfigAdmin(
  adminUid: string,
  config: Omit<LevelConfig, 'id' | 'updatedBy' | 'updatedAt'>
): Promise<void> {
  const sanitizedLevels = config.levels.slice(0, 5).map((lvl, idx) => ({
    level: idx + 1,
    name: lvl.name.trim().slice(0, 28) || DEFAULT_LEVEL_TIERS[idx].name,
    minHours: Math.max(1, Math.round(Number(lvl.minHours) || DEFAULT_LEVEL_TIERS[idx].minHours)),
    badgeColor: lvl.badgeColor || DEFAULT_LEVEL_TIERS[idx].badgeColor,
    badgeEmoji: lvl.badgeEmoji || DEFAULT_LEVEL_TIERS[idx].badgeEmoji,
  }));

  await setDoc(doc(db, 'appSettings', 'levelConfig'), {
    id: 'levelConfig',
    levels: sanitizedLevels,
    enableVipFrames: Boolean(config.enableVipFrames),
    enableVipNameColors: Boolean(config.enableVipNameColors),
    enableVipExclusiveEmojis: Boolean(config.enableVipExclusiveEmojis),
    enableVipRoomAccess: Boolean(config.enableVipRoomAccess),
    enableVipEntryAnimation: Boolean(config.enableVipEntryAnimation),
    vipBadgeColor: config.vipBadgeColor || '#F59E0B',
    updatedBy: adminUid,
    updatedAt: serverTimestamp(),
  });
}

export function subscribeMySpeakingStats(uid: string, onData: (stats: SpeakingStats | null) => void): () => void {
  return onSnapshot(
    doc(db, 'speakingStats', uid),
    (snap) => onData(snap.exists() ? (snap.data() as SpeakingStats) : null),
    () => onData(null)
  );
}

export function subscribeAllSpeakingStatsMap(onData: (map: Record<string, SpeakingStats>) => void): () => void {
  return onSnapshot(
    query(collection(db, 'speakingStats'), limit(200)),
    (snap) => {
      const map: Record<string, SpeakingStats> = {};
      const currentMonth = getCurrentMonthKey();
      const nowMs = Date.now();
      snap.docs.forEach((d) => {
        const s = d.data() as SpeakingStats;
        map[d.id] =
          s.monthKey === currentMonth && s.cycleEndsAt > nowMs
            ? s
            : { ...s, monthlySeconds: 0, monthKey: currentMonth, cycleEndsAt: getCycleEndMillis() };
      });
      onData(map);
    },
    () => {}
  );
}

export function subscribeSpeakingHistory(uid: string, onData: (items: SpeakingMonthHistory[]) => void): () => void {
  return onSnapshot(
    query(collection(db, 'speakingStats', uid, 'history'), limit(24)),
    (snap) => {
      const list = snap.docs.map((d) => d.data() as SpeakingMonthHistory);
      list.sort((a, b) => b.monthKey.localeCompare(a.monthKey));
      onData(list);
    },
    () => onData([])
  );
}

export async function fetchUserSpeakingHistory(uid: string): Promise<SpeakingMonthHistory[]> {
  const snap = await getDocs(query(collection(db, 'speakingStats', uid, 'history'), limit(24)));
  const list = snap.docs.map((d) => d.data() as SpeakingMonthHistory);
  list.sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  return list;
}

export async function syncOrResetMonthlyCycle(
  uid: string,
  config: LevelConfig = DEFAULT_LEVEL_CONFIG
): Promise<SpeakingStats> {
  const now = new Date();
  const currentMonth = getCurrentMonthKey(now);
  const cycleEndsAt = getCycleEndMillis(now);
  const statsRef = doc(db, 'speakingStats', uid);
  const existingSnap = await getDoc(statsRef);

  if (!existingSnap.exists()) {
    const initial: SpeakingStats = {
      uid,
      monthKey: currentMonth,
      cycleEndsAt,
      monthlySeconds: 0,
      lifetimeSeconds: 0,
      lastRoomId: '',
      lastHeartbeatAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(statsRef, initial);
    return initial;
  }

  const prev = existingSnap.data() as SpeakingStats;
  if (prev.monthKey === currentMonth) {
    return prev;
  }

  const oldSummary = computeLevelSummary({ ...prev, cycleEndsAt: Date.now() + 60000 }, config);
  await setDoc(doc(db, 'speakingStats', uid, 'history', prev.monthKey), {
    uid,
    monthKey: prev.monthKey,
    speakingSeconds: prev.monthlySeconds,
    achievedLevel: oldSummary.currentLevel,
    levelName: oldSummary.currentTier?.name || 'Newcomer',
    wasVip: oldSummary.isVip,
    archivedAt: serverTimestamp(),
  });

  await runTransaction(db, async (tx) => {
    tx.update(statsRef, {
      monthKey: currentMonth,
      cycleEndsAt,
      monthlySeconds: 0,
      lastHeartbeatAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  return {
    ...prev,
    monthKey: currentMonth,
    cycleEndsAt,
    monthlySeconds: 0,
  };
}

export async function recordVerifiedSpeakingSeconds(params: {
  uid: string;
  activeSeconds: number;
  roomId: string;
  config?: LevelConfig;
}): Promise<void> {
  const delta = Math.min(25, Math.max(0, Math.round(params.activeSeconds)));
  if (delta <= 0) return;

  const now = new Date();
  const currentMonth = getCurrentMonthKey(now);
  const cycleEndsAt = getCycleEndMillis(now);
  const statsRef = doc(db, 'speakingStats', params.uid);
  const existingSnap = await getDoc(statsRef);

  if (!existingSnap.exists()) {
    await setDoc(statsRef, {
      uid: params.uid,
      monthKey: currentMonth,
      cycleEndsAt,
      monthlySeconds: delta,
      lifetimeSeconds: delta,
      lastRoomId: params.roomId.slice(0, 128),
      lastHeartbeatAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  const prev = existingSnap.data() as SpeakingStats;
  if (prev.monthKey !== currentMonth) {
    await syncOrResetMonthlyCycle(params.uid, params.config || DEFAULT_LEVEL_CONFIG);
  }

  await runTransaction(db, async (tx) => {
    const freshSnap = await tx.get(statsRef);
    const data = freshSnap.data() as SpeakingStats | undefined;
    if (!data) return;
    const isRollover = data.monthKey !== currentMonth;
    const nextMonthly = isRollover ? delta : data.monthlySeconds + delta;
    const nextLifetime = data.lifetimeSeconds + delta;
    tx.update(statsRef, {
      monthKey: currentMonth,
      cycleEndsAt,
      monthlySeconds: nextMonthly,
      lifetimeSeconds: nextLifetime,
      lastRoomId: params.roomId.slice(0, 128),
      lastHeartbeatAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}

// ---------- Cache Helpers ----------
const CACHE_POSTS = 'bandhu_mob_posts_v2';
const CACHE_USERS = 'bandhu_mob_users_v2';

export async function getCachedPosts(): Promise<Post[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_POSTS);
    return raw ? (JSON.parse(raw) as Post[]) : [];
  } catch {
    return [];
  }
}

export async function getCachedUsers(): Promise<UserProfile[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_USERS);
    return raw ? (JSON.parse(raw) as UserProfile[]) : [];
  } catch {
    return [];
  }
}

// ---------- Auth, Profile & Presence ----------
export async function ensureUserProfile(
  authUser: User,
  overrides?: { displayName?: string; username?: string; phoneNumber?: string }
): Promise<UserProfile> {
  const userRef = doc(db, 'users', authUser.uid);
  const privateRef = doc(db, 'users', authUser.uid, 'private', 'info');
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    const existing = snap.data() as Partial<UserProfile>;
    const normalized: UserProfile = {
      uid: authUser.uid,
      username: existing.username || sanitizeUsername('', authUser.uid),
      displayName: existing.displayName || authUser.displayName || 'Bandhu Member',
      bio: existing.bio ?? '',
      location: existing.location ?? '',
      workOrBioTag: existing.workOrBioTag ?? '',
      photoURL: existing.photoURL || authUser.photoURL || '',
      coverURL: existing.coverURL || '',
      profileVisibility: existing.profileVisibility || 'public',
      messagePrivacy: existing.messagePrivacy || 'everyone',
      showOnlineStatus: existing.showOnlineStatus ?? true,
      isVerified: existing.isVerified ?? false,
      followersCount: existing.followersCount ?? 0,
      followingCount: existing.followingCount ?? 0,
      postsCount: existing.postsCount ?? 0,
      isSuspended: existing.isSuspended ?? false,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    };

    const privSnap = await getDoc(privateRef).catch(() => null);
    if (!privSnap || !privSnap.exists()) {
      await setDoc(privateRef, {
        uid: authUser.uid,
        email: (authUser.email || '').slice(0, 120),
        phoneNumber: (overrides?.phoneNumber || authUser.phoneNumber || '').slice(0, 24),
        role: 'user',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return normalized;
  }

  const baseName =
    overrides?.displayName?.trim() ||
    authUser.displayName?.trim() ||
    authUser.email?.split('@')[0] ||
    'Bandhu Member';
  const displayName = baseName.slice(0, 60);
  const username = sanitizeUsername(
    overrides?.username || authUser.email?.split('@')[0] || baseName,
    authUser.uid
  );

  const profile: UserProfile = {
    uid: authUser.uid,
    username,
    displayName,
    bio: 'Sharing moments on BANDHU MELA.',
    location: '',
    workOrBioTag: '',
    photoURL: (authUser.photoURL || '').slice(0, 2000),
    coverURL: '',
    profileVisibility: 'public',
    messagePrivacy: 'everyone',
    showOnlineStatus: true,
    isVerified: false,
    followersCount: 0,
    followingCount: 0,
    postsCount: 0,
    isSuspended: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  batch.set(userRef, profile);
  batch.set(privateRef, {
    uid: authUser.uid,
    email: (authUser.email || '').slice(0, 120),
    phoneNumber: (overrides?.phoneNumber || authUser.phoneNumber || '').slice(0, 24),
    role: 'user',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();

  const created = await getDoc(userRef);
  return (created.data() as UserProfile) || profile;
}

export async function getPrivateUserInfo(uid: string): Promise<UserPrivateInfo | null> {
  const snap = await getDoc(doc(db, 'users', uid, 'private', 'info')).catch(() => null);
  return snap && snap.exists() ? (snap.data() as UserPrivateInfo) : null;
}

export async function updateUserProfile(
  uid: string,
  updates: Partial<
    Pick<
      UserProfile,
      | 'displayName'
      | 'username'
      | 'bio'
      | 'location'
      | 'workOrBioTag'
      | 'photoURL'
      | 'coverURL'
      | 'profileVisibility'
      | 'messagePrivacy'
      | 'showOnlineStatus'
    >
  >
): Promise<void> {
  const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (typeof updates.displayName === 'string') {
    clean.displayName = updates.displayName.trim().slice(0, 60) || 'Bandhu Member';
  }
  if (typeof updates.username === 'string') {
    clean.username = sanitizeUsername(updates.username, uid);
  }
  if (typeof updates.bio === 'string') {
    clean.bio = updates.bio.trim().slice(0, 300);
  }
  if (typeof updates.location === 'string') {
    clean.location = updates.location.trim().slice(0, 80);
  }
  if (typeof updates.workOrBioTag === 'string') {
    clean.workOrBioTag = updates.workOrBioTag.trim().slice(0, 80);
  }
  if (typeof updates.photoURL === 'string') {
    clean.photoURL = updates.photoURL.slice(0, 2000);
  }
  if (typeof updates.coverURL === 'string') {
    clean.coverURL = updates.coverURL.slice(0, 2000);
  }
  if (updates.profileVisibility) {
    clean.profileVisibility = updates.profileVisibility;
  }
  if (updates.messagePrivacy) {
    clean.messagePrivacy = updates.messagePrivacy;
  }
  if (typeof updates.showOnlineStatus === 'boolean') {
    clean.showOnlineStatus = updates.showOnlineStatus;
  }
  await updateDoc(doc(db, 'users', uid), clean);
}

export interface OriginalOwnerStatus {
  isOriginalOwner: boolean;
  ownerUid: string | null;
  locked: boolean;
  backendVerified: boolean;
}

export async function claimAndVerifyOriginalOwner(authUser: User): Promise<OriginalOwnerStatus> {
  const isCandidate =
    Boolean(authUser.emailVerified) &&
    authUser.uid === ORIGINAL_OWNER_UID &&
    authUser.email?.toLowerCase() === OWNER_ADMIN_EMAIL;

  const registryRef = doc(db, 'ownerRegistry', 'original');
  const registrySnap = await getDoc(registryRef);

  let ownerUid: string | null = null;
  let locked = false;

  if (registrySnap.exists()) {
    const data = registrySnap.data() as { uid?: string; locked?: boolean };
    ownerUid = data.uid || null;
    locked = Boolean(data.locked);
  } else if (isCandidate) {
    try {
      await setDoc(registryRef, {
        id: 'original',
        uid: authUser.uid,
        email: OWNER_ADMIN_EMAIL,
        role: 'super_admin_owner',
        locked: true,
        claimedAt: serverTimestamp(),
      });
      ownerUid = authUser.uid;
      locked = true;

      const settingsRef = doc(db, 'appSettings', 'platform');
      const settingsSnap = await getDoc(settingsRef).catch(() => null);
      if (!settingsSnap || !settingsSnap.exists()) {
        await setDoc(settingsRef, {
          ...DEFAULT_APP_SETTINGS,
          ownerUid: authUser.uid,
          updatedBy: authUser.uid,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      } else if (!settingsSnap.data()?.ownerUid) {
        await updateDoc(settingsRef, {
          ownerUid: authUser.uid,
          updatedBy: authUser.uid,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    } catch {
      const recheck = await getDoc(registryRef).catch(() => null);
      if (recheck && recheck.exists()) {
        const data = recheck.data() as { uid?: string; locked?: boolean };
        ownerUid = data.uid || null;
        locked = Boolean(data.locked);
      }
    }
  }

  const isOriginalOwner = Boolean(
    isCandidate && ownerUid && ownerUid === ORIGINAL_OWNER_UID && ownerUid === authUser.uid
  );
  if (!isOriginalOwner) {
    return { isOriginalOwner: false, ownerUid: ownerUid || ORIGINAL_OWNER_UID, locked, backendVerified: false };
  }

  let backendVerified = false;
  try {
    const idToken = await authUser.getIdToken();
    const base = SERVER_API_BASE.replace(/\/$/, '');
    const resp = await fetch(`${base}/api/owner/verify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
    });
    if (resp.ok) {
      const payload = (await resp.json()) as {
        verified?: boolean;
        isOriginalOwner?: boolean;
        ownerUid?: string;
      };
      backendVerified = Boolean(
        payload.verified && payload.isOriginalOwner && payload.ownerUid === authUser.uid
      );
    }
  } catch {
    backendVerified = false;
  }

  return {
    isOriginalOwner: true,
    ownerUid: authUser.uid,
    locked,
    backendVerified,
  };
}

export async function checkIsAdminRecord(uid: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'admins', uid));
    return snap.exists() && !snap.data()?.isSuspended;
  } catch {
    return false;
  }
}

export async function setUserPresence(uid: string, isOnline: boolean): Promise<void> {
  try {
    await setDoc(doc(db, 'presence', uid), {
      uid,
      isOnline,
      lastSeen: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking presence update
  }
}

export function subscribeAllUsers(onData: (users: UserProfile[]) => void): () => void {
  return onSnapshot(
    query(collection(db, 'users'), where('isSuspended', '==', false), limit(100)),
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as UserProfile)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      void AsyncStorage.setItem(CACHE_USERS, JSON.stringify(list.slice(0, 60)));
      onData(list);
    },
    () => {}
  );
}

export function subscribeAllPresence(onData: (map: Record<string, UserPresence>) => void): () => void {
  return onSnapshot(
    query(collection(db, 'presence'), limit(180)),
    (snap) => {
      const map: Record<string, UserPresence> = {};
      snap.docs.forEach((d) => {
        const p = d.data() as UserPresence;
        map[p.uid || d.id] = p;
      });
      onData(map);
    },
    () => {}
  );
}

// ---------- Feed, Posts, Stories, Ranking ----------
export function subscribeFeedPosts(onData: (posts: Post[]) => void, maxLimit = 25): () => void {
  const q = query(collection(db, 'posts'), where('status', '==', 'active'), limit(maxLimit));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as Post)
        .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      void AsyncStorage.setItem(CACHE_POSTS, JSON.stringify(list.slice(0, 25)));
      onData(list);
    },
    () => {}
  );
}

export function rankTrendingPosts(posts: Post[]): Post[] {
  const now = Date.now();
  return [...posts].sort((a, b) => {
    const ageA = Math.max(1, (now - (toMillis(a.createdAt) || now)) / 3600000);
    const ageB = Math.max(1, (now - (toMillis(b.createdAt) || now)) / 3600000);
    const scoreA = (a.likesCount * 2 + a.commentsCount * 3 + a.sharesCount * 4 + (a.mediaUrl ? 1.5 : 0) + 1) / Math.pow(ageA + 2, 1.15);
    const scoreB = (b.likesCount * 2 + b.commentsCount * 3 + b.sharesCount * 4 + (b.mediaUrl ? 1.5 : 0) + 1) / Math.pow(ageB + 2, 1.15);
    return scoreB - scoreA;
  });
}

export function getSuggestedFriends(
  currentUser: UserProfile,
  allUsers: UserProfile[],
  followingIds: Set<string>,
  friendRequests: FriendRequest[],
  blockedIds: Set<string>
): UserProfile[] {
  const pendingOrFriend = new Set<string>();
  friendRequests.forEach((r) => {
    if (r.status === 'pending' || r.status === 'accepted') {
      pendingOrFriend.add(r.senderId === currentUser.uid ? r.receiverId : r.senderId);
    }
  });
  return allUsers
    .filter(
      (u) =>
        u.uid !== currentUser.uid &&
        !u.isSuspended &&
        !blockedIds.has(u.uid) &&
        !followingIds.has(u.uid) &&
        !pendingOrFriend.has(u.uid)
    )
    .sort((a, b) => (b.followersCount || 0) - (a.followersCount || 0));
}

export async function createPost(params: {
  author: UserProfile;
  caption: string;
  mediaUrl?: string;
  mediaType: MediaType;
  aspectRatio?: AspectRatio;
}): Promise<string> {
  const id = makeId('post');
  const cleanCaption = params.caption.trim().slice(0, 2200);
  const ratio: AspectRatio = params.aspectRatio || (params.mediaType === 'reel' ? '9:16' : '4:3');

  const batch = writeBatch(db);
  batch.set(doc(db, 'posts', id), {
    id,
    authorId: params.author.uid,
    authorName: params.author.displayName.slice(0, 60),
    authorUsername: params.author.username.slice(0, 30),
    authorPhoto: params.author.photoURL.slice(0, 2000),
    caption: cleanCaption,
    hashtags: extractHashtags(cleanCaption),
    mediaUrl: (params.mediaUrl || '').trim().slice(0, 2000),
    mediaType: params.mediaType,
    aspectRatio: ratio,
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', params.author.uid), {
    postsCount: increment(1),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return id;
}

export async function deleteOwnPost(post: Post, uid: string): Promise<void> {
  if (post.authorId !== uid) throw new Error('Only the author can delete this post');
  const batch = writeBatch(db);
  batch.delete(doc(db, 'posts', post.id));
  batch.update(doc(db, 'users', uid), {
    postsCount: increment(-1),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function checkIsPostLiked(postId: string, uid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'posts', postId, 'likes', uid));
  return snap.exists();
}

export async function toggleLikePost(post: Post, actor: UserProfile, currentlyLiked: boolean): Promise<boolean> {
  const likeRef = doc(db, 'posts', post.id, 'likes', actor.uid);
  const postRef = doc(db, 'posts', post.id);
  const batch = writeBatch(db);
  if (currentlyLiked) {
    batch.delete(likeRef);
    batch.update(postRef, { likesCount: increment(-1), updatedAt: serverTimestamp() });
  } else {
    batch.set(likeRef, { userId: actor.uid, postId: post.id, createdAt: serverTimestamp() });
    batch.update(postRef, { likesCount: increment(1), updatedAt: serverTimestamp() });
  }
  await batch.commit();

  if (!currentlyLiked && post.authorId !== actor.uid) {
    await createNotification({
      recipientId: post.authorId,
      actor,
      type: 'like',
      postId: post.id,
      message: `${actor.displayName} liked your ${post.mediaType === 'reel' ? 'reel' : 'post'}.`,
    });
  }
  return !currentlyLiked;
}

export async function incrementPostShare(postId: string): Promise<void> {
  await updateDoc(doc(db, 'posts', postId), {
    sharesCount: increment(1),
    updatedAt: serverTimestamp(),
  });
}

export function subscribeSavedPostIds(uid: string, onData: (ids: Set<string>) => void): () => void {
  return onSnapshot(collection(db, 'users', uid, 'savedPosts'), (snap) => {
    onData(new Set(snap.docs.map((d) => d.id)));
  });
}

export async function toggleSavePost(uid: string, postId: string, currentlySaved: boolean): Promise<void> {
  const refDoc = doc(db, 'users', uid, 'savedPosts', postId);
  if (currentlySaved) {
    await deleteDoc(refDoc);
  } else {
    await setDoc(refDoc, { postId, userId: uid, createdAt: serverTimestamp() });
  }
}

export function subscribePostComments(postId: string, onData: (items: PostComment[]) => void): () => void {
  const q = query(collection(db, 'posts', postId, 'comments'), where('postId', '==', postId), limit(100));
  return onSnapshot(q, (snap) => {
    const list = snap.docs
      .map((d) => d.data() as PostComment)
      .sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
    onData(list);
  });
}

export async function addPostComment(post: Post, actor: UserProfile, text: string): Promise<void> {
  const clean = text.trim().slice(0, 1000);
  if (!clean) return;
  const id = makeId('cmt');
  const batch = writeBatch(db);
  batch.set(doc(db, 'posts', post.id, 'comments', id), {
    id,
    postId: post.id,
    authorId: actor.uid,
    authorName: actor.displayName.slice(0, 60),
    authorUsername: actor.username.slice(0, 30),
    authorPhoto: actor.photoURL.slice(0, 2000),
    text: clean,
    createdAt: serverTimestamp(),
  });
  batch.update(doc(db, 'posts', post.id), {
    commentsCount: increment(1),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();

  if (post.authorId !== actor.uid) {
    await createNotification({
      recipientId: post.authorId,
      actor,
      type: 'comment',
      postId: post.id,
      message: `${actor.displayName} commented: "${clean.slice(0, 60)}"`,
    });
  }
}

export function subscribeActiveStories(onData: (stories: StoryItem[]) => void): () => void {
  const q = query(collection(db, 'stories'), where('expiresAt', '>', Timestamp.now()), limit(60));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as StoryItem)
        .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(list);
    },
    () => {}
  );
}

export async function createStory(params: {
  author: UserProfile;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  caption?: string;
}): Promise<void> {
  const id = makeId('sty');
  await setDoc(doc(db, 'stories', id), {
    id,
    authorId: params.author.uid,
    authorName: params.author.displayName.slice(0, 60),
    authorUsername: params.author.username.slice(0, 30),
    authorPhoto: params.author.photoURL.slice(0, 2000),
    mediaUrl: params.mediaUrl.trim().slice(0, 2000),
    mediaType: params.mediaType,
    caption: (params.caption || '').trim().slice(0, 300),
    viewersCount: 0,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
  });
}

// ---------- Follow & Friend Requests ----------
export function subscribeMyFollowing(uid: string, onData: (ids: Set<string>) => void): () => void {
  return onSnapshot(query(collection(db, 'follows'), where('followerId', '==', uid), limit(200)), (snap) => {
    onData(new Set(snap.docs.map((d) => (d.data() as FollowRecord).followingId)));
  });
}

export async function toggleFollowUser(actor: UserProfile, targetUid: string, currentlyFollowing: boolean): Promise<void> {
  if (actor.uid === targetUid) return;
  const followId = `${actor.uid}_${targetUid}`;
  const followRef = doc(db, 'follows', followId);
  const batch = writeBatch(db);
  if (currentlyFollowing) {
    batch.delete(followRef);
    batch.update(doc(db, 'users', actor.uid), { followingCount: increment(-1), updatedAt: serverTimestamp() });
    batch.update(doc(db, 'users', targetUid), { followersCount: increment(-1), updatedAt: serverTimestamp() });
  } else {
    batch.set(followRef, { followerId: actor.uid, followingId: targetUid, createdAt: serverTimestamp() });
    batch.update(doc(db, 'users', actor.uid), { followingCount: increment(1), updatedAt: serverTimestamp() });
    batch.update(doc(db, 'users', targetUid), { followersCount: increment(1), updatedAt: serverTimestamp() });
  }
  await batch.commit();
  if (!currentlyFollowing) {
    await createNotification({
      recipientId: targetUid,
      actor,
      type: 'follow',
      message: `${actor.displayName} started following you.`,
    });
  }
}

export function subscribeFriendRequests(uid: string, onData: (items: FriendRequest[]) => void): () => void {
  let sent: FriendRequest[] = [];
  let recv: FriendRequest[] = [];
  const emit = () => {
    const map = new Map<string, FriendRequest>();
    [...sent, ...recv].forEach((r) => map.set(r.id, r));
    onData(Array.from(map.values()).sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt)));
  };
  const u1 = onSnapshot(query(collection(db, 'friendRequests'), where('senderId', '==', uid), limit(100)), (s) => {
    sent = s.docs.map((d) => d.data() as FriendRequest);
    emit();
  });
  const u2 = onSnapshot(query(collection(db, 'friendRequests'), where('receiverId', '==', uid), limit(100)), (s) => {
    recv = s.docs.map((d) => d.data() as FriendRequest);
    emit();
  });
  return () => {
    u1();
    u2();
  };
}

export async function sendFriendRequest(sender: UserProfile, receiver: UserProfile): Promise<void> {
  const id = makePairId(sender.uid, receiver.uid);
  await setDoc(doc(db, 'friendRequests', id), {
    id,
    senderId: sender.uid,
    senderName: sender.displayName.slice(0, 60),
    senderUsername: sender.username.slice(0, 30),
    senderPhoto: sender.photoURL.slice(0, 2000),
    receiverId: receiver.uid,
    receiverName: receiver.displayName.slice(0, 60),
    receiverUsername: receiver.username.slice(0, 30),
    receiverPhoto: receiver.photoURL.slice(0, 2000),
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await createNotification({
    recipientId: receiver.uid,
    actor: sender,
    type: 'friend_request',
    message: `${sender.displayName} sent you a friend request.`,
  });
}

export async function respondFriendRequest(
  reqItem: FriendRequest,
  actor: UserProfile,
  decision: 'accepted' | 'declined'
): Promise<void> {
  await updateDoc(doc(db, 'friendRequests', reqItem.id), {
    status: decision,
    updatedAt: serverTimestamp(),
  });
  if (decision === 'accepted') {
    await createNotification({
      recipientId: reqItem.senderId,
      actor,
      type: 'friend_accept',
      message: `${actor.displayName} accepted your friend request.`,
    });
  }
}

// ---------- Chat & Calls ----------
export function subscribeConversations(uid: string, onData: (items: Conversation[]) => void): () => void {
  const q = query(collection(db, 'conversations'), where('participants', 'array-contains', uid), limit(50));
  return onSnapshot(q, (snap) => {
    onData(snap.docs.map((d) => d.data() as Conversation).sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt)));
  });
}

export async function getOrCreateDirectConversation(me: UserProfile, peer: UserProfile): Promise<Conversation> {
  const convId = makePairId(me.uid, peer.uid);
  const convRef = doc(db, 'conversations', convId);
  const snap = await getDoc(convRef);
  if (snap.exists()) return snap.data() as Conversation;

  const first = me.uid < peer.uid ? me : peer;
  const second = me.uid < peer.uid ? peer : me;
  const conv: Conversation = {
    id: convId,
    isGroup: false,
    groupName: '',
    groupPhoto: '',
    createdBy: me.uid,
    participantA: first.uid,
    participantB: second.uid,
    participants: [first.uid, second.uid],
    participantAName: first.displayName.slice(0, 60),
    participantAPhoto: first.photoURL.slice(0, 2000),
    participantBName: second.displayName.slice(0, 60),
    participantBPhoto: second.photoURL.slice(0, 2000),
    lastMessage: '',
    lastSenderId: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(convRef, conv);
  return conv;
}

export async function createGroupConversation(me: UserProfile, name: string, members: UserProfile[]): Promise<Conversation> {
  const convId = makeId('grp');
  const participantIds = Array.from(new Set([me.uid, ...members.map((m) => m.uid)])).slice(0, 25);
  const conv: Conversation = {
    id: convId,
    isGroup: true,
    groupName: name.trim().slice(0, 80) || 'Bandhu Group',
    groupPhoto: me.photoURL.slice(0, 2000),
    createdBy: me.uid,
    participantA: me.uid,
    participantB: members[0]?.uid || me.uid,
    participants: participantIds,
    participantAName: me.displayName.slice(0, 60),
    participantAPhoto: me.photoURL.slice(0, 2000),
    participantBName: members[0]?.displayName.slice(0, 60) || 'Members',
    participantBPhoto: members[0]?.photoURL.slice(0, 2000) || '',
    lastMessage: `${me.displayName} created group "${name.trim()}"`,
    lastSenderId: me.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'conversations', convId), conv);
  return conv;
}

export function subscribeMessages(
  conversationId: string,
  uid: string,
  onData: (msgs: ChatMessage[]) => void
): () => void {
  const q = query(
    collection(db, 'conversations', conversationId, 'messages'),
    where('participants', 'array-contains', uid),
    limit(150)
  );
  return onSnapshot(q, (snap) => {
    onData(snap.docs.map((d) => d.data() as ChatMessage).sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt)));
  });
}

export async function sendChatMessage(params: {
  conversation: Conversation;
  sender: UserProfile;
  text: string;
  mediaUrl?: string;
}): Promise<void> {
  const clean = (params.text.trim() || (params.mediaUrl ? 'Sent an attachment' : '')).slice(0, 2000);
  if (!clean) return;
  const id = makeId('msg');
  const batch = writeBatch(db);
  batch.set(doc(db, 'conversations', params.conversation.id, 'messages', id), {
    id,
    conversationId: params.conversation.id,
    senderId: params.sender.uid,
    senderName: params.sender.displayName.slice(0, 60),
    senderPhoto: params.sender.photoURL.slice(0, 2000),
    participants: params.conversation.participants,
    text: clean,
    mediaUrl: (params.mediaUrl || '').slice(0, 2000),
    createdAt: serverTimestamp(),
  });
  batch.update(doc(db, 'conversations', params.conversation.id), {
    lastMessage: clean.slice(0, 500),
    lastSenderId: params.sender.uid,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function startCallSession(caller: UserProfile, callee: UserProfile, callType: 'audio' | 'video'): Promise<void> {
  const id = makeId('call');
  await setDoc(doc(db, 'calls', id), {
    id,
    callerId: caller.uid,
    callerName: caller.displayName.slice(0, 60),
    callerPhoto: caller.photoURL.slice(0, 2000),
    calleeId: callee.uid,
    calleeName: callee.displayName.slice(0, 60),
    calleePhoto: callee.photoURL.slice(0, 2000),
    participants: [caller.uid, callee.uid],
    callType,
    status: 'ringing',
    offerSdp: '',
    answerSdp: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await createNotification({
    recipientId: callee.uid,
    actor: caller,
    type: 'call',
    postId: id,
    message: `Incoming ${callType} call from ${caller.displayName}`,
  });
}

// ---------- Live Video ----------
export function subscribeLiveStreams(onData: (items: LiveStream[]) => void): () => void {
  const q = query(collection(db, 'liveStreams'), where('status', '==', 'live'), limit(30));
  return onSnapshot(q, (snap) => {
    onData(snap.docs.map((d) => d.data() as LiveStream).sort((a, b) => toMillis(b.startedAt) - toMillis(a.startedAt)));
  });
}

export async function startLiveStream(host: UserProfile, title: string): Promise<LiveStream> {
  const id = makeId('live');
  const stream: LiveStream = {
    id,
    hostId: host.uid,
    hostName: host.displayName.slice(0, 60),
    hostUsername: host.username.slice(0, 30),
    hostPhoto: host.photoURL.slice(0, 2000),
    title: title.trim().slice(0, 160) || `${host.displayName} is Live`,
    status: 'live',
    viewersCount: 0,
    reactionsCount: 0,
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'liveStreams', id), stream);
  return stream;
}

export async function endLiveStream(streamId: string): Promise<void> {
  await updateDoc(doc(db, 'liveStreams', streamId), {
    status: 'ended',
    updatedAt: serverTimestamp(),
  });
}

export function subscribeLiveComments(streamId: string, onData: (items: LiveComment[]) => void): () => void {
  const q = query(collection(db, 'liveStreams', streamId, 'comments'), where('streamId', '==', streamId), limit(100));
  return onSnapshot(q, (snap) => {
    onData(snap.docs.map((d) => d.data() as LiveComment).sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt)));
  });
}

export async function addLiveComment(
  streamId: string,
  author: UserProfile,
  text: string,
  kind: 'comment' | 'reaction' = 'comment'
): Promise<void> {
  const id = makeId('lc');
  const batch = writeBatch(db);
  batch.set(doc(db, 'liveStreams', streamId, 'comments', id), {
    id,
    streamId,
    authorId: author.uid,
    authorName: author.displayName.slice(0, 60),
    authorPhoto: author.photoURL.slice(0, 2000),
    text: text.trim().slice(0, 300),
    kind,
    createdAt: serverTimestamp(),
  });
  if (kind === 'reaction') {
    batch.update(doc(db, 'liveStreams', streamId), {
      reactionsCount: increment(1),
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

// ---------- Notifications, Blocks, Reports ----------
export function subscribeNotifications(uid: string, onData: (items: NotificationItem[]) => void): () => void {
  const q = query(collection(db, 'notifications'), where('recipientId', '==', uid), limit(60));
  return onSnapshot(q, (snap) => {
    onData(snap.docs.map((d) => d.data() as NotificationItem).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)));
  });
}

export async function createNotification(params: {
  recipientId: string;
  actor: UserProfile;
  type: NotificationItem['type'];
  postId?: string;
  message: string;
}): Promise<void> {
  if (params.recipientId === params.actor.uid) return;
  const id = makeId('ntf');
  await setDoc(doc(db, 'notifications', id), {
    id,
    recipientId: params.recipientId,
    actorId: params.actor.uid,
    actorName: params.actor.displayName.slice(0, 60),
    actorPhoto: params.actor.photoURL.slice(0, 2000),
    type: params.type,
    postId: (params.postId || '').slice(0, 128),
    message: params.message.slice(0, 300),
    read: false,
    createdAt: serverTimestamp(),
  });
}

export async function markAllNotificationsRead(items: NotificationItem[]): Promise<void> {
  const unread = items.filter((n) => !n.read);
  if (!unread.length) return;
  const batch = writeBatch(db);
  unread.slice(0, 400).forEach((n) => batch.update(doc(db, 'notifications', n.id), { read: true }));
  await batch.commit();
}

export function subscribeBlocks(uid: string, onData: (blockedByMe: Set<string>, blockedMe: Set<string>) => void): () => void {
  let byMe = new Set<string>();
  let me = new Set<string>();
  const u1 = onSnapshot(query(collection(db, 'blocks'), where('blockerId', '==', uid), limit(100)), (s) => {
    byMe = new Set(s.docs.map((d) => String(d.data().blockedId)));
    onData(byMe, me);
  });
  const u2 = onSnapshot(query(collection(db, 'blocks'), where('blockedId', '==', uid), limit(100)), (s) => {
    me = new Set(s.docs.map((d) => String(d.data().blockerId)));
    onData(byMe, me);
  });
  return () => {
    u1();
    u2();
  };
}

export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  await setDoc(doc(db, 'blocks', `${blockerId}_${blockedId}`), {
    blockerId,
    blockedId,
    createdAt: serverTimestamp(),
  });
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  await deleteDoc(doc(db, 'blocks', `${blockerId}_${blockedId}`));
}

export async function submitReport(params: {
  reporter: UserProfile;
  targetType: 'post' | 'user' | 'comment';
  targetId: string;
  targetOwnerId?: string;
  reason: string;
  details?: string;
}): Promise<void> {
  const id = makeId('rep');
  await setDoc(doc(db, 'reports', id), {
    id,
    reporterId: params.reporter.uid,
    reporterUsername: params.reporter.username.slice(0, 30),
    targetType: params.targetType,
    targetId: params.targetId,
    targetOwnerId: params.targetOwnerId || '',
    reason: params.reason.trim().slice(0, 120),
    details: (params.details || '').trim().slice(0, 1000),
    status: 'open',
    adminNotes: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// ---------- Communities, Events, Support & Data ----------
export function subscribeCommunities(onData: (items: CommunityGroup[]) => void): () => void {
  return onSnapshot(query(collection(db, 'communities'), where('membersCount', '>=', 0), limit(60)), (snap) => {
    onData(snap.docs.map((d) => d.data() as CommunityGroup).sort((a, b) => b.membersCount - a.membersCount));
  });
}

export async function createCommunity(creator: UserProfile, name: string, description: string, category: string): Promise<string> {
  const id = makeId('grp');
  await setDoc(doc(db, 'communities', id), {
    id,
    name: name.trim().slice(0, 80),
    description: description.trim().slice(0, 500),
    category: category.trim().slice(0, 50) || 'General',
    coverUrl: '',
    creatorId: creator.uid,
    creatorName: creator.displayName.slice(0, 60),
    membersCount: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'communities', id, 'members', creator.uid), {
    userId: creator.uid,
    communityId: id,
    displayName: creator.displayName.slice(0, 60),
    photoURL: creator.photoURL.slice(0, 2000),
    role: 'admin',
    joinedAt: serverTimestamp(),
  });
  return id;
}

export function subscribeCommunityMembers(communityId: string, onData: (members: CommunityMember[]) => void): () => void {
  return onSnapshot(
    query(collection(db, 'communities', communityId, 'members'), where('communityId', '==', communityId), limit(100)),
    (snap) => onData(snap.docs.map((d) => d.data() as CommunityMember))
  );
}

export async function toggleCommunityMembership(communityId: string, user: UserProfile, isMember: boolean): Promise<boolean> {
  const memberRef = doc(db, 'communities', communityId, 'members', user.uid);
  const commRef = doc(db, 'communities', communityId);
  const batch = writeBatch(db);
  if (isMember) {
    batch.delete(memberRef);
    batch.update(commRef, { membersCount: increment(-1), updatedAt: serverTimestamp() });
  } else {
    batch.set(memberRef, {
      userId: user.uid,
      communityId,
      displayName: user.displayName.slice(0, 60),
      photoURL: user.photoURL.slice(0, 2000),
      role: 'member',
      joinedAt: serverTimestamp(),
    });
    batch.update(commRef, { membersCount: increment(1), updatedAt: serverTimestamp() });
  }
  await batch.commit();
  return !isMember;
}

export function subscribeEvents(onData: (items: CommunityEvent[]) => void): () => void {
  return onSnapshot(query(collection(db, 'events'), where('attendeesCount', '>=', 0), limit(60)), (snap) => {
    onData(snap.docs.map((d) => d.data() as CommunityEvent).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)));
  });
}

export async function createEvent(host: UserProfile, title: string, description: string, location: string, daysFromNow = 3): Promise<string> {
  const id = makeId('evt');
  const eventDate = new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 16);
  await setDoc(doc(db, 'events', id), {
    id,
    title: title.trim().slice(0, 120),
    description: description.trim().slice(0, 1000),
    location: location.trim().slice(0, 140),
    eventDate,
    coverUrl: '',
    hostId: host.uid,
    hostName: host.displayName.slice(0, 60),
    attendeesCount: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'events', id, 'rsvps', host.uid), {
    userId: host.uid,
    eventId: id,
    displayName: host.displayName.slice(0, 60),
    status: 'going',
    updatedAt: serverTimestamp(),
  });
  return id;
}

export function subscribeEventRsvps(eventId: string, onData: (rsvps: EventRsvp[]) => void): () => void {
  return onSnapshot(
    query(collection(db, 'events', eventId, 'rsvps'), where('eventId', '==', eventId), limit(100)),
    (snap) => onData(snap.docs.map((d) => d.data() as EventRsvp))
  );
}

export async function toggleEventRsvp(eventId: string, user: UserProfile, alreadyGoing: boolean): Promise<void> {
  const rsvpRef = doc(db, 'events', eventId, 'rsvps', user.uid);
  const eventRef = doc(db, 'events', eventId);
  const batch = writeBatch(db);
  if (alreadyGoing) {
    batch.delete(rsvpRef);
    batch.update(eventRef, { attendeesCount: increment(-1), updatedAt: serverTimestamp() });
  } else {
    batch.set(rsvpRef, {
      userId: user.uid,
      eventId,
      displayName: user.displayName.slice(0, 60),
      status: 'going',
      updatedAt: serverTimestamp(),
    });
    batch.update(eventRef, { attendeesCount: increment(1), updatedAt: serverTimestamp() });
  }
  await batch.commit();
}

export function subscribeMySupportTickets(uid: string, onData: (items: SupportTicket[]) => void): () => void {
  return onSnapshot(query(collection(db, 'supportTickets'), where('userId', '==', uid), limit(50)), (snap) => {
    onData(snap.docs.map((d) => d.data() as SupportTicket).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)));
  });
}

export async function submitSupportTicket(params: {
  user: UserProfile;
  subject: string;
  category: string;
  message: string;
}): Promise<void> {
  const id = makeId('tkt');
  await setDoc(doc(db, 'supportTickets', id), {
    id,
    userId: params.user.uid,
    username: params.user.username.slice(0, 30),
    category: params.category.slice(0, 60),
    subject: params.subject.trim().slice(0, 140),
    message: params.message.trim().slice(0, 1500),
    status: 'open',
    adminReply: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function exportMyPersonalData(uid: string): Promise<string> {
  const [profileSnap, privSnap, postsSnap, walletSnap, statsSnap] = await Promise.all([
    getDoc(doc(db, 'users', uid)),
    getDoc(doc(db, 'users', uid, 'private', 'info')).catch(() => null),
    getDocs(query(collection(db, 'posts'), where('authorId', '==', uid), limit(100))),
    getDoc(doc(db, 'wallets', uid)).catch(() => null),
    getDoc(doc(db, 'speakingStats', uid)).catch(() => null),
  ]);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      platform: 'BANDHU MELA',
      publicProfile: profileSnap.data() || null,
      privateInfo: privSnap && privSnap.exists() ? privSnap.data() : null,
      wallet: walletSnap && walletSnap.exists() ? walletSnap.data() : null,
      speakingStats: statsSnap && statsSnap.exists() ? statsSnap.data() : null,
      posts: postsSnap.docs.map((d) => d.data()),
    },
    null,
    2
  );
}

export async function deleteUserAccountData(authUser: User): Promise<void> {
  const uid = authUser.uid;
  const postsSnap = await getDocs(query(collection(db, 'posts'), where('authorId', '==', uid), limit(100)));
  const batch = writeBatch(db);
  postsSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, 'presence', uid));
  batch.delete(doc(db, 'users', uid, 'private', 'info'));
  batch.delete(doc(db, 'users', uid));
  await batch.commit();
  await deleteUser(authUser);
}

// ---------- Platform Announcements & Settings ----------
export function subscribeActiveAnnouncements(onData: (items: Announcement[]) => void): () => void {
  return onSnapshot(query(collection(db, 'announcements'), where('active', '==', true), limit(15)), (snap) => {
    onData(snap.docs.map((d) => d.data() as Announcement).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)));
  });
}

export function subscribeAppSettings(onData: (settings: AppSettings) => void): () => void {
  return onSnapshot(doc(db, 'appSettings', 'platform'), (snap) => {
    onData(snap.exists() ? { ...DEFAULT_APP_SETTINGS, ...(snap.data() as Partial<AppSettings>) } : DEFAULT_APP_SETTINGS);
  });
}

// ---------- BANDHU MELA Audio Party & Virtual Gifts ----------
export function subscribeLiveAudioRooms(onData: (rooms: AudioRoom[]) => void): () => void {
  return onSnapshot(query(collection(db, 'audioRooms'), where('status', '==', 'live'), limit(50)), (snap) => {
    onData(
      snap.docs
        .map((d) => d.data() as AudioRoom)
        .sort((a, b) => b.participantsCount - a.participantsCount || toMillis(b.createdAt) - toMillis(a.createdAt))
    );
  });
}

export function subscribeAudioParticipants(roomId: string, onData: (items: AudioRoomParticipant[]) => void): () => void {
  return onSnapshot(
    query(collection(db, 'audioRooms', roomId, 'participants'), where('roomId', '==', roomId), limit(150)),
    (snap) => {
      onData(
        snap.docs
          .map((d) => d.data() as AudioRoomParticipant)
          .sort((a, b) => a.seatNumber - b.seatNumber || toMillis(a.joinedAt) - toMillis(b.joinedAt))
      );
    }
  );
}

export function subscribeAudioMessages(roomId: string, onData: (items: AudioRoomMessage[]) => void): () => void {
  return onSnapshot(
    query(collection(db, 'audioRooms', roomId, 'messages'), where('roomId', '==', roomId), limit(120)),
    (snap) => {
      onData(snap.docs.map((d) => d.data() as AudioRoomMessage).sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt)));
    }
  );
}

export function subscribeRoomGiftEvents(
  roomId: string,
  onData: (items: GiftEvent[], meta?: { fromCache: boolean }) => void
): () => void {
  return onSnapshot(query(collection(db, 'giftEvents'), where('roomId', '==', roomId)), (snap) => {
    const confirmed = snap.docs
      .filter((d) => !d.metadata.hasPendingWrites)
      .map((d) => d.data() as GiftEvent)
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    onData(confirmed, { fromCache: snap.metadata.fromCache });
  });
}

export async function createAudioRoom(params: {
  host: UserProfile;
  title: string;
  topic: string;
  visibility: 'public' | 'private';
  vipOnly?: boolean;
  rawPasscode?: string;
}): Promise<AudioRoom> {
  const roomId = makeId('aud');
  const passcodeHash =
    params.visibility === 'private' && params.rawPasscode?.trim()
      ? await hashRoomPasscode(roomId, params.rawPasscode)
      : '';
  const room: AudioRoom = {
    id: roomId,
    title: params.title.trim().slice(0, 120),
    topic: params.topic.trim().slice(0, 60) || 'Open Adda',
    visibility: params.visibility,
    vipOnly: Boolean(params.vipOnly),
    passcodeHash,
    hostId: params.host.uid,
    hostName: params.host.displayName.slice(0, 60),
    hostUsername: params.host.username.slice(0, 30),
    hostPhoto: params.host.photoURL.slice(0, 2000),
    moderatorIds: [],
    speakerIds: [params.host.uid],
    status: 'live',
    participantsCount: 1,
    giftsCoinsTotal: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'audioRooms', roomId), room);
  await setDoc(doc(db, 'audioRooms', roomId, 'participants', params.host.uid), {
    userId: params.host.uid,
    roomId,
    displayName: params.host.displayName.slice(0, 60),
    username: params.host.username.slice(0, 30),
    photoURL: params.host.photoURL.slice(0, 2000),
    role: 'host',
    seatNumber: 1,
    isMuted: false,
    handRaised: false,
    invitedToSpeak: false,
    isBanned: false,
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return room;
}

export async function joinAudioRoom(room: AudioRoom, user: UserProfile): Promise<AudioRoomParticipant> {
  const partRef = doc(db, 'audioRooms', room.id, 'participants', user.uid);
  const existing = await getDoc(partRef);
  if (existing.exists()) {
    const data = existing.data() as AudioRoomParticipant;
    if (data.isBanned) throw new Error('You have been removed or blocked from this audio room.');
    await updateDoc(partRef, {
      displayName: user.displayName.slice(0, 60),
      photoURL: user.photoURL.slice(0, 2000),
      updatedAt: serverTimestamp(),
    });
    return data;
  }

  const participant: AudioRoomParticipant = {
    userId: user.uid,
    roomId: room.id,
    displayName: user.displayName.slice(0, 60),
    username: user.username.slice(0, 30),
    photoURL: user.photoURL.slice(0, 2000),
    role: room.hostId === user.uid ? 'host' : 'listener',
    seatNumber: room.hostId === user.uid ? 1 : 0,
    isMuted: room.hostId !== user.uid,
    handRaised: false,
    invitedToSpeak: false,
    isBanned: false,
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  batch.set(partRef, participant);
  batch.update(doc(db, 'audioRooms', room.id), {
    participantsCount: increment(1),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return participant;
}

export async function leaveAudioRoom(room: AudioRoom, uid: string): Promise<void> {
  const partRef = doc(db, 'audioRooms', room.id, 'participants', uid);
  const snap = await getDoc(partRef).catch(() => null);
  if (!snap || !snap.exists()) return;
  const data = snap.data() as AudioRoomParticipant;
  if (data.isBanned) return;

  const batch = writeBatch(db);
  batch.delete(partRef);
  if (room.participantsCount > 0) {
    batch.update(doc(db, 'audioRooms', room.id), {
      participantsCount: increment(-1),
      updatedAt: serverTimestamp(),
    });
  }
  if (room.speakerIds.includes(uid) && room.hostId !== uid) {
    batch.update(doc(db, 'audioRooms', room.id), {
      speakerIds: room.speakerIds.filter((id) => id !== uid),
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit().catch(() => {});
}

export async function endAudioRoom(roomId: string): Promise<void> {
  await updateDoc(doc(db, 'audioRooms', roomId), {
    status: 'ended',
    updatedAt: serverTimestamp(),
  });
}

export async function toggleRaiseHand(roomId: string, uid: string, currentlyRaised: boolean): Promise<void> {
  await updateDoc(doc(db, 'audioRooms', roomId, 'participants', uid), {
    handRaised: !currentlyRaised,
    updatedAt: serverTimestamp(),
  });
}

export async function inviteToSpeak(roomId: string, targetUid: string, invited: boolean): Promise<void> {
  await updateDoc(doc(db, 'audioRooms', roomId, 'participants', targetUid), {
    invitedToSpeak: invited,
    updatedAt: serverTimestamp(),
  });
}

export async function acceptSpeakerInvite(
  room: AudioRoom,
  uid: string,
  participants: AudioRoomParticipant[]
): Promise<number> {
  const taken = new Set(participants.filter((p) => p.seatNumber > 0).map((p) => p.seatNumber));
  let freeSeat = 0;
  for (let s = 1; s <= 5; s++) {
    if (!taken.has(s)) {
      freeSeat = s;
      break;
    }
  }
  if (!freeSeat || room.speakerIds.length >= 5) {
    throw new Error('All 5 speaker seats are currently occupied.');
  }
  const nextSpeakers = Array.from(new Set([...room.speakerIds, uid])).slice(0, 5);
  const batch = writeBatch(db);
  batch.update(doc(db, 'audioRooms', room.id, 'participants', uid), {
    role: 'speaker',
    seatNumber: freeSeat,
    isMuted: false,
    handRaised: false,
    invitedToSpeak: false,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'audioRooms', room.id), {
    speakerIds: nextSpeakers,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return freeSeat;
}

export async function moveSpeakerToListener(room: AudioRoom, targetUid: string): Promise<void> {
  const nextSpeakers = room.speakerIds.filter((id) => id !== targetUid);
  const batch = writeBatch(db);
  batch.update(doc(db, 'audioRooms', room.id, 'participants', targetUid), {
    role: room.moderatorIds.includes(targetUid) ? 'moderator' : 'listener',
    seatNumber: 0,
    isMuted: true,
    invitedToSpeak: false,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'audioRooms', room.id), {
    speakerIds: nextSpeakers,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function toggleParticipantMute(roomId: string, targetUid: string, currentlyMuted: boolean): Promise<void> {
  await updateDoc(doc(db, 'audioRooms', roomId, 'participants', targetUid), {
    isMuted: !currentlyMuted,
    updatedAt: serverTimestamp(),
  });
}

export async function toggleRoomModerator(room: AudioRoom, targetUid: string, makeMod: boolean): Promise<void> {
  const nextMods = makeMod
    ? Array.from(new Set([...room.moderatorIds, targetUid])).slice(0, 10)
    : room.moderatorIds.filter((id) => id !== targetUid);
  const batch = writeBatch(db);
  batch.update(doc(db, 'audioRooms', room.id), {
    moderatorIds: nextMods,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'audioRooms', room.id, 'participants', targetUid), {
    role: makeMod ? 'moderator' : room.speakerIds.includes(targetUid) ? 'speaker' : 'listener',
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function banAudioParticipant(room: AudioRoom, targetUid: string): Promise<void> {
  const nextSpeakers = room.speakerIds.filter((id) => id !== targetUid);
  const nextMods = room.moderatorIds.filter((id) => id !== targetUid);
  const batch = writeBatch(db);
  batch.update(doc(db, 'audioRooms', room.id, 'participants', targetUid), {
    isBanned: true,
    role: 'listener',
    seatNumber: 0,
    isMuted: true,
    handRaised: false,
    invitedToSpeak: false,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'audioRooms', room.id), {
    speakerIds: nextSpeakers,
    moderatorIds: nextMods,
    participantsCount: room.participantsCount > 0 ? increment(-1) : 0,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function sendAudioRoomMessage(params: {
  roomId: string;
  sender: UserProfile;
  kind: AudioRoomMessage['kind'];
  text: string;
}): Promise<void> {
  const id = makeId('amsg');
  await setDoc(doc(db, 'audioRooms', params.roomId, 'messages', id), {
    id,
    roomId: params.roomId,
    senderId: params.sender.uid,
    senderName: params.sender.displayName.slice(0, 60),
    senderPhoto: params.sender.photoURL.slice(0, 2000),
    kind: params.kind,
    text: params.text.trim().slice(0, 400),
    giftId: '',
    giftName: '',
    giftEmoji: '',
    recipientName: '',
    createdAt: serverTimestamp(),
  });
}

// ---------- Wallet & Virtual Gifts ----------
export async function ensureUserWallet(uid: string): Promise<UserWallet> {
  const wRef = doc(db, 'wallets', uid);
  const snap = await getDoc(wRef);
  if (snap.exists()) return snap.data() as UserWallet;

  const initial: UserWallet = {
    uid,
    coinsBalance: 100,
    earnedBeans: 0,
    totalSpent: 0,
    totalPurchased: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const batch = writeBatch(db);
  batch.set(wRef, initial);
  const txId = makeId('tx');
  batch.set(doc(db, 'coinTransactions', txId), {
    id: txId,
    userId: uid,
    counterpartyId: 'bandhu_mela',
    counterpartyName: 'BANDHU MELA Welcome',
    type: 'starter',
    coinsDelta: 100,
    note: 'Welcome starter coins for Audio Party gifts',
    referenceId: 'starter_bonus',
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  return initial;
}

export function subscribeMyWallet(uid: string, onData: (w: UserWallet | null) => void): () => void {
  return onSnapshot(doc(db, 'wallets', uid), (snap) => {
    onData(snap.exists() ? (snap.data() as UserWallet) : null);
  });
}

export function subscribeVirtualGifts(onData: (gifts: VirtualGift[]) => void): () => void {
  return onSnapshot(query(collection(db, 'virtualGifts'), limit(50)), (snap) => {
    if (snap.empty) {
      onData(DEFAULT_VIRTUAL_GIFTS);
      return;
    }
    const list = snap.docs.map((d) => d.data() as VirtualGift);
    const loveDefault = DEFAULT_VIRTUAL_GIFTS.find((g) => g.id === 'gift_love_couple');
    if (loveDefault && !list.some((g) => g.id === 'gift_love_couple')) {
      list.push(loveDefault);
    }
    onData(list.sort((a, b) => a.coinPrice - b.coinPrice));
  });
}

export function subscribeCoinPackages(onData: (pkgs: CoinPackage[]) => void): () => void {
  return onSnapshot(query(collection(db, 'coinPackages'), limit(30)), (snap) => {
    const legacySet = new Set<string>(LEGACY_COIN_PACKAGE_IDS);
    const list = snap.docs
      .map((d) => d.data() as CoinPackage)
      .filter((pkg) => !legacySet.has(pkg.id));
    onData((list.length ? list : DEFAULT_COIN_PACKAGES).sort((a, b) => a.coins - b.coins));
  });
}

const inFlightMobileGiftSends = new Set<string>();

export async function sendVirtualGift(params: {
  room: AudioRoom;
  sender: UserProfile;
  recipient: { uid: string; displayName: string };
  gift: VirtualGift;
}): Promise<{
  eventId: string;
  transactionId: string;
  coinsCost: number;
  giftName: string;
  giftEmoji: string;
  animationType: VirtualGift['animationType'];
}> {
  if (params.sender.uid === params.recipient.uid) {
    throw new Error('Select a co-host or guest speaker to send a gift.');
  }

  const lockKey = `${params.room.id}:${params.sender.uid}:${params.gift.id}`;
  if (inFlightMobileGiftSends.has(lockKey)) {
    throw new Error('Gift transaction is already being processed...');
  }
  inFlightMobileGiftSends.add(lockKey);

  try {
    await ensureUserWallet(params.sender.uid);

    const senderWalletRef = doc(db, 'wallets', params.sender.uid);
    const recipientWalletRef = doc(db, 'wallets', params.recipient.uid);
    const giftCatalogRef = doc(db, 'virtualGifts', params.gift.id);
    const roomRef = doc(db, 'audioRooms', params.room.id);

    const eventId = makeId('gft');
    const txSentId = makeId('txs');
    const txRecvId = makeId('txr');
    const msgId = makeId('amsg');

    return await runTransaction(db, async (tx) => {
      const [senderSnap, recipientSnap, giftSnap, roomSnap] = await Promise.all([
        tx.get(senderWalletRef),
        tx.get(recipientWalletRef),
        tx.get(giftCatalogRef),
        tx.get(roomRef),
      ]);

      if (!roomSnap.exists() || (roomSnap.data() as AudioRoom).status !== 'live') {
        throw new Error('This Audio Party room is no longer live.');
      }

      if (!senderSnap.exists()) {
        throw new Error('Sender wallet is not ready yet. Please try again.');
      }

      if (!recipientSnap.exists()) {
        throw new Error(`${params.recipient.displayName} has not activated their wallet yet.`);
      }

      const catalogGift = giftSnap.exists() ? (giftSnap.data() as VirtualGift) : params.gift;
      if (!catalogGift.active) {
        throw new Error(`${catalogGift.name} is currently disabled by the Platform Owner.`);
      }

      const livePrice = Math.max(1, Math.round(catalogGift.coinPrice));
      const liveName = catalogGift.name.trim().slice(0, 40);
      const liveEmoji = catalogGift.emoji.trim().slice(0, 16);
      const liveAnim = catalogGift.animationType;

      const senderWallet = senderSnap.data() as UserWallet;
      if (senderWallet.coinsBalance < livePrice) {
        throw new Error(`Not enough coins (${senderWallet.coinsBalance} available, ${livePrice} needed).`);
      }

      tx.update(senderWalletRef, {
        coinsBalance: senderWallet.coinsBalance - livePrice,
        totalSpent: senderWallet.totalSpent + livePrice,
        updatedAt: serverTimestamp(),
      });
      tx.update(recipientWalletRef, {
        earnedBeans: increment(livePrice),
        updatedAt: serverTimestamp(),
      });
      tx.set(doc(db, 'giftEvents', eventId), {
        id: eventId,
        roomId: params.room.id,
        roomTitle: params.room.title.slice(0, 120),
        senderId: params.sender.uid,
        senderName: params.sender.displayName.slice(0, 60),
        senderPhoto: params.sender.photoURL.slice(0, 2000),
        recipientId: params.recipient.uid,
        recipientName: params.recipient.displayName.slice(0, 60),
        giftId: params.gift.id,
        giftName: liveName,
        giftEmoji: liveEmoji,
        coinsCost: livePrice,
        transactionId: txSentId,
        animationType: liveAnim,
        createdAt: serverTimestamp(),
      });
      tx.set(doc(db, 'coinTransactions', txSentId), {
        id: txSentId,
        userId: params.sender.uid,
        counterpartyId: params.recipient.uid,
        counterpartyName: params.recipient.displayName.slice(0, 60),
        type: 'gift_sent',
        coinsDelta: -livePrice,
        note: `Sent ${liveEmoji} ${liveName} to ${params.recipient.displayName} (#${txSentId})`,
        referenceId: eventId,
        createdAt: serverTimestamp(),
      });
      tx.set(doc(db, 'coinTransactions', txRecvId), {
        id: txRecvId,
        userId: params.recipient.uid,
        counterpartyId: params.sender.uid,
        counterpartyName: params.sender.displayName.slice(0, 60),
        type: 'gift_received',
        coinsDelta: livePrice,
        note: `Received ${liveEmoji} ${liveName} from ${params.sender.displayName} (#${txRecvId})`,
        referenceId: eventId,
        createdAt: serverTimestamp(),
      });
      tx.set(doc(db, 'audioRooms', params.room.id, 'messages', msgId), {
        id: msgId,
        roomId: params.room.id,
        senderId: params.sender.uid,
        senderName: params.sender.displayName.slice(0, 60),
        senderPhoto: params.sender.photoURL.slice(0, 2000),
        kind: 'gift',
        text: `sent ${liveName} to ${params.recipient.displayName}`,
        giftId: params.gift.id,
        giftName: liveName,
        giftEmoji: liveEmoji,
        recipientName: params.recipient.displayName.slice(0, 60),
        createdAt: serverTimestamp(),
      });
      tx.update(roomRef, {
        giftsCoinsTotal: increment(livePrice),
        updatedAt: serverTimestamp(),
      });

      return {
        eventId,
        transactionId: txSentId,
        coinsCost: livePrice,
        giftName: liveName,
        giftEmoji: liveEmoji,
        animationType: liveAnim,
      };
    });
  } finally {
    inFlightMobileGiftSends.delete(lockKey);
  }
}

export function subscribeMyCoinTransactions(uid: string, onData: (items: CoinTransaction[]) => void): () => void {
  return onSnapshot(query(collection(db, 'coinTransactions'), where('userId', '==', uid), limit(80)), (snap) => {
    onData(snap.docs.map((d) => d.data() as CoinTransaction).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)));
  });
}

export function subscribeMyGiftHistory(uid: string, onData: (sent: GiftEvent[], received: GiftEvent[]) => void): () => void {
  let sent: GiftEvent[] = [];
  let recv: GiftEvent[] = [];
  const u1 = onSnapshot(query(collection(db, 'giftEvents'), where('senderId', '==', uid), limit(60)), (s) => {
    sent = s.docs.map((d) => d.data() as GiftEvent).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    onData(sent, recv);
  });
  const u2 = onSnapshot(query(collection(db, 'giftEvents'), where('recipientId', '==', uid), limit(60)), (s) => {
    recv = s.docs.map((d) => d.data() as GiftEvent).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    onData(sent, recv);
  });
  return () => {
    u1();
    u2();
  };
}

export async function submitCoinTopupRequest(params: {
  user: UserProfile;
  pkg: CoinPackage;
  paymentProvider: CoinTopupRequest['paymentProvider'];
  paymentRef: string;
}): Promise<void> {
  const id = makeId('top');
  await setDoc(doc(db, 'coinTopupRequests', id), {
    id,
    userId: params.user.uid,
    username: params.user.username.slice(0, 30),
    packageId: params.pkg.id,
    packageName: params.pkg.name.slice(0, 60),
    coins: params.pkg.coins + (params.pkg.bonusCoins || 0),
    amountLabel: `₹${params.pkg.priceInr.toLocaleString('en-IN')}`,
    paymentProvider: params.paymentProvider,
    paymentRef: params.paymentRef.slice(0, 160),
    status: 'pending',
    adminNote: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function subscribeMyCoinTopupRequests(uid: string, onData: (items: CoinTopupRequest[]) => void): () => void {
  return onSnapshot(query(collection(db, 'coinTopupRequests'), where('userId', '==', uid), limit(40)), (snap) => {
    onData(snap.docs.map((d) => d.data() as CoinTopupRequest).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)));
  });
}

// ---------- Super Admin Owner Panel ----------
export async function logAdminAction(params: {
  actor: UserProfile;
  actorRole: 'owner' | 'admin' | 'moderator';
  action: string;
  targetType: string;
  targetId: string;
  details: string;
}): Promise<void> {
  const id = makeId('log');
  await setDoc(doc(db, 'auditLogs', id), {
    id,
    actorId: params.actor.uid,
    actorName: params.actor.displayName.slice(0, 60),
    actorRole: params.actorRole,
    action: params.action.slice(0, 80),
    targetType: params.targetType.slice(0, 40),
    targetId: params.targetId.slice(0, 128),
    details: params.details.slice(0, 400),
    createdAt: serverTimestamp(),
  });
}

export async function fetchOwnerDashboardData(isOriginalOwner: boolean): Promise<{
  users: UserProfile[];
  admins: AdminRecord[];
  audioRooms: AudioRoom[];
  reports: ModerationReport[];
  posts: Post[];
  tickets: SupportTicket[];
  announcements: Announcement[];
  topups: CoinTopupRequest[];
  wallets: UserWallet[];
  transactions: CoinTransaction[];
  auditLogs: AuditLogEntry[];
}> {
  const [u, ad, ar, rp, ps, tk, an] = await Promise.all([
    getDocs(query(collection(db, 'users'), limit(150))),
    getDocs(query(collection(db, 'admins'), limit(50))).catch(() => ({ docs: [] })),
    getDocs(query(collection(db, 'audioRooms'), limit(80))).catch(() => ({ docs: [] })),
    getDocs(query(collection(db, 'reports'), limit(80))).catch(() => ({ docs: [] })),
    getDocs(query(collection(db, 'posts'), limit(100))).catch(() => ({ docs: [] })),
    getDocs(query(collection(db, 'supportTickets'), limit(80))).catch(() => ({ docs: [] })),
    getDocs(query(collection(db, 'announcements'), limit(50))).catch(() => ({ docs: [] })),
  ]);

  let topups: CoinTopupRequest[] = [];
  let wallets: UserWallet[] = [];
  let transactions: CoinTransaction[] = [];
  let auditLogs: AuditLogEntry[] = [];

  if (isOriginalOwner) {
    const [tp, wl, tx, au] = await Promise.all([
      getDocs(query(collection(db, 'coinTopupRequests'), limit(80))).catch(() => ({ docs: [] })),
      getDocs(query(collection(db, 'wallets'), limit(120))).catch(() => ({ docs: [] })),
      getDocs(query(collection(db, 'coinTransactions'), limit(120))).catch(() => ({ docs: [] })),
      getDocs(query(collection(db, 'auditLogs'), limit(100))).catch(() => ({ docs: [] })),
    ]);
    topups = tp.docs.map((d) => d.data() as CoinTopupRequest).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    wallets = wl.docs.map((d) => d.data() as UserWallet);
    transactions = tx.docs.map((d) => d.data() as CoinTransaction).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    auditLogs = au.docs.map((d) => d.data() as AuditLogEntry).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }

  return {
    users: u.docs.map((d) => d.data() as UserProfile),
    admins: ad.docs.map((d) => d.data() as AdminRecord),
    audioRooms: ar.docs.map((d) => d.data() as AudioRoom).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)),
    reports: rp.docs.map((d) => d.data() as ModerationReport).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)),
    posts: ps.docs.map((d) => d.data() as Post).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)),
    tickets: tk.docs.map((d) => d.data() as SupportTicket).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)),
    announcements: an.docs.map((d) => d.data() as Announcement).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)),
    topups,
    wallets,
    transactions,
    auditLogs,
  };
}

export async function adminSetUserSuspended(uid: string, suspended: boolean): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { isSuspended: suspended, updatedAt: serverTimestamp() });
}

export async function adminSetUserVerified(uid: string, verified: boolean): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { isVerified: verified, updatedAt: serverTimestamp() });
}

export interface ResolvedAdminCandidate {
  uid: string;
  displayName: string;
  username: string;
  email: string;
  photoURL: string;
  isVerified: boolean;
  isSuspended: boolean;
  isProtectedOwner?: boolean;
}

export interface AdminLookupResponse {
  user: ResolvedAdminCandidate;
  existingAdmin: AdminRecord | null;
  currentRole: 'super_admin_owner' | 'admin' | 'moderator' | 'user';
  isProtectedOwner: boolean;
}

async function getOwnerApiHeaders(forceRefresh = false): Promise<{ base: string; headers: Record<string, string> }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in with Original Owner account first.');
  const token = await user.getIdToken(forceRefresh);
  return {
    base: SERVER_API_BASE.replace(/\/$/, ''),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
}

export async function ownerLookupUserForAdmin(identifier: string): Promise<AdminLookupResponse> {
  const cleanIdentifier = identifier.trim();
  if (!cleanIdentifier) {
    throw new Error('Please enter a registered user email address or Firebase UID.');
  }

  const doRequest = async (forceRefresh: boolean) => {
    const { base, headers } = await getOwnerApiHeaders(forceRefresh);
    try {
      const resp = await fetch(`${base}/api/owner/admins/lookup`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ identifier: cleanIdentifier }),
      });
      return { resp, base };
    } catch (networkErr) {
      const msg = networkErr instanceof Error ? networkErr.message : 'Network request failed';
      throw new Error(`Could not connect to backend (${base}/api/owner/admins/lookup): ${msg}`);
    }
  };

  let result = await doRequest(false);
  if (result.resp.status === 401) {
    result = await doRequest(true);
  }

  const rawText = await result.resp.text().catch(() => '');
  let parsed: {
    user?: ResolvedAdminCandidate;
    existingAdmin?: AdminRecord | null;
    currentRole?: 'super_admin_owner' | 'admin' | 'moderator' | 'user';
    isProtectedOwner?: boolean;
    error?: string;
  } | null = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
  }

  if (!result.resp.ok || !parsed?.user) {
    throw new Error(
      parsed?.error ||
        `User lookup failed (HTTP ${result.resp.status})${rawText ? `: ${rawText.slice(0, 140)}` : ''}`
    );
  }

  const existingAdmin = parsed.existingAdmin || null;
  const isProtectedOwner = Boolean(parsed.isProtectedOwner || parsed.user.isProtectedOwner);
  const currentRole =
    parsed.currentRole ||
    (isProtectedOwner
      ? 'super_admin_owner'
      : existingAdmin
      ? existingAdmin.role === 'admin'
        ? 'admin'
        : 'moderator'
      : 'user');

  return {
    user: parsed.user,
    existingAdmin,
    currentRole,
    isProtectedOwner,
  };
}

export async function ownerCreateAdminOrModerator(params: {
  identifier: string;
  role: 'admin' | 'moderator';
  notes?: string;
}): Promise<AdminRecord> {
  const { base, headers } = await getOwnerApiHeaders();
  const resp = await fetch(`${base}/api/owner/admins`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = (await resp.json().catch(() => ({}))) as { admin?: AdminRecord; error?: string };
  if (!resp.ok || !data.admin) {
    throw new Error(data.error || 'Unable to create Admin or Moderator.');
  }
  return data.admin;
}

export async function ownerUpdateAdminStatusOrRole(
  targetUid: string,
  patch: { role?: 'admin' | 'moderator'; isSuspended?: boolean; notes?: string }
): Promise<void> {
  const { base, headers } = await getOwnerApiHeaders();
  const resp = await fetch(`${base}/api/owner/admins/${encodeURIComponent(targetUid)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
  const data = (await resp.json().catch(() => ({}))) as { error?: string };
  if (!resp.ok) {
    throw new Error(data.error || 'Unable to update Admin or Moderator.');
  }
}

export async function ownerRemoveAdminOrModerator(targetUid: string): Promise<void> {
  const { base, headers } = await getOwnerApiHeaders();
  const resp = await fetch(`${base}/api/owner/admins/${encodeURIComponent(targetUid)}`, {
    method: 'DELETE',
    headers,
  });
  const data = (await resp.json().catch(() => ({}))) as { error?: string };
  if (!resp.ok) {
    throw new Error(data.error || 'Unable to remove Admin or Moderator.');
  }
}

export async function grantAdminRole(params: {
  uid: string;
  grantedBy: string;
  role: 'admin' | 'moderator';
  displayName: string;
  email?: string;
  notes?: string;
}): Promise<void> {
  await setDoc(doc(db, 'admins', params.uid), {
    uid: params.uid,
    grantedBy: params.grantedBy,
    role: params.role,
    isSuspended: false,
    displayName: params.displayName.slice(0, 60),
    email: (params.email || '').slice(0, 120),
    notes: (params.notes || '').slice(0, 300),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateAdminRecord(
  uid: string,
  patch: { role?: 'admin' | 'moderator'; isSuspended?: boolean; notes?: string }
): Promise<void> {
  await updateDoc(doc(db, 'admins', uid), { ...patch, updatedAt: serverTimestamp() });
}

export async function revokeAdminRole(uid: string): Promise<void> {
  await deleteDoc(doc(db, 'admins', uid));
}

export async function adminSetPostStatus(postId: string, status: 'active' | 'hidden'): Promise<void> {
  await updateDoc(doc(db, 'posts', postId), { status, updatedAt: serverTimestamp() });
}

export async function adminDeletePost(postId: string): Promise<void> {
  await deleteDoc(doc(db, 'posts', postId));
}

export async function adminUpdateReport(reportId: string, status: ModerationReport['status'], adminNotes = ''): Promise<void> {
  await updateDoc(doc(db, 'reports', reportId), {
    status,
    adminNotes: adminNotes.slice(0, 1000),
    updatedAt: serverTimestamp(),
  });
}

export async function adminReplySupportTicket(
  ticketId: string,
  status: SupportTicket['status'],
  adminReply: string
): Promise<void> {
  await updateDoc(doc(db, 'supportTickets', ticketId), {
    status,
    adminReply: adminReply.trim().slice(0, 1000),
    updatedAt: serverTimestamp(),
  });
}

export async function createAnnouncement(params: {
  author: UserProfile;
  title: string;
  message: string;
  priority: 'normal' | 'important';
}): Promise<void> {
  const id = makeId('ann');
  await setDoc(doc(db, 'announcements', id), {
    id,
    title: params.title.trim().slice(0, 120),
    message: params.message.trim().slice(0, 1000),
    priority: params.priority,
    authorId: params.author.uid,
    authorName: params.author.displayName.slice(0, 60),
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await deleteDoc(doc(db, 'announcements', id));
}

export async function saveAppSettings(
  uid: string,
  settings: Partial<AppSettings>,
  ownerUid?: string
): Promise<void> {
  await setDoc(doc(db, 'appSettings', 'platform'), {
    id: 'platform',
    maintenanceMode: Boolean(settings.maintenanceMode),
    allowNewRegistrations: settings.allowNewRegistrations ?? true,
    allowLiveStreaming: settings.allowLiveStreaming ?? true,
    allowVideoReels: settings.allowVideoReels ?? true,
    allowAudioRooms: settings.allowAudioRooms ?? true,
    allowVirtualGifts: settings.allowVirtualGifts ?? true,
    allowCoinPurchases: settings.allowCoinPurchases ?? true,
    ownerUid: (ownerUid || settings.ownerUid || uid).slice(0, 128),
    welcomeHeadline: (settings.welcomeHeadline || DEFAULT_APP_SETTINGS.welcomeHeadline).trim().slice(0, 160),
    updatedBy: uid,
    updatedAt: serverTimestamp(),
  });
}

export async function saveVirtualGift(gift: Omit<VirtualGift, 'createdAt' | 'updatedAt'>): Promise<void> {
  const refDoc = doc(db, 'virtualGifts', gift.id);
  const existing = await getDoc(refDoc);
  await setDoc(refDoc, {
    ...gift,
    name: gift.name.trim().slice(0, 40),
    emoji: gift.emoji.trim().slice(0, 16),
    coinPrice: Math.max(1, Math.round(gift.coinPrice)),
    createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteVirtualGift(giftId: string): Promise<void> {
  await deleteDoc(doc(db, 'virtualGifts', giftId));
}

export async function saveCoinPackage(pkg: Omit<CoinPackage, 'createdAt' | 'updatedAt'>): Promise<void> {
  const refDoc = doc(db, 'coinPackages', pkg.id);
  const existing = await getDoc(refDoc);
  await setDoc(refDoc, {
    ...pkg,
    name: pkg.name.trim().slice(0, 60),
    coins: Math.max(1, Math.round(pkg.coins)),
    bonusCoins: Math.max(0, Math.round(pkg.bonusCoins)),
    priceUsd: Math.max(0, Number(pkg.priceUsd)),
    priceInr: Math.max(0, Math.round(pkg.priceInr)),
    createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteCoinPackage(pkgId: string): Promise<void> {
  await deleteDoc(doc(db, 'coinPackages', pkgId));
}

export async function reviewCoinTopupRequestOwner(
  reqItem: CoinTopupRequest,
  decision: 'approved' | 'rejected',
  adminNote: string,
  ownerActor: UserProfile
): Promise<void> {
  const reqRef = doc(db, 'coinTopupRequests', reqItem.id);
  const walletRef = doc(db, 'wallets', reqItem.userId);
  const walletSnap = await getDoc(walletRef);

  const batch = writeBatch(db);
  batch.update(reqRef, {
    status: decision,
    adminNote: adminNote.trim().slice(0, 300),
    updatedAt: serverTimestamp(),
  });

  if (decision === 'approved') {
    if (walletSnap.exists()) {
      batch.update(walletRef, {
        coinsBalance: increment(reqItem.coins),
        totalPurchased: increment(reqItem.coins),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(walletRef, {
        uid: reqItem.userId,
        coinsBalance: reqItem.coins,
        earnedBeans: 0,
        totalSpent: 0,
        totalPurchased: reqItem.coins,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    const txId = makeId('txp');
    batch.set(doc(db, 'coinTransactions', txId), {
      id: txId,
      userId: reqItem.userId,
      counterpartyId: ownerActor.uid,
      counterpartyName: 'BANDHU MELA Coin Store',
      type: 'purchase',
      coinsDelta: reqItem.coins,
      note: `Approved ${reqItem.packageName} (${reqItem.amountLabel})`,
      referenceId: reqItem.id,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

export async function adjustUserWalletOwner(params: {
  ownerActor: UserProfile;
  targetUid: string;
  deltaCoins: number;
  note: string;
}): Promise<void> {
  const walletRef = doc(db, 'wallets', params.targetUid);
  const snap = await getDoc(walletRef);
  const current = snap.exists() ? (snap.data() as UserWallet) : null;
  const nextBalance = Math.max(0, (current?.coinsBalance || 0) + params.deltaCoins);

  const batch = writeBatch(db);
  if (current) {
    batch.update(walletRef, {
      coinsBalance: nextBalance,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(walletRef, {
      uid: params.targetUid,
      coinsBalance: nextBalance,
      earnedBeans: 0,
      totalSpent: 0,
      totalPurchased: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  const txId = makeId('txo');
  batch.set(doc(db, 'coinTransactions', txId), {
    id: txId,
    userId: params.targetUid,
    counterpartyId: params.ownerActor.uid,
    counterpartyName: 'Owner Super Admin',
    type: 'owner_adjustment',
    coinsDelta: params.deltaCoins,
    note: params.note.trim().slice(0, 200) || 'Owner balance adjustment',
    referenceId: txId,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function exportFullPlatformBackupJson(): Promise<string> {
  const [users, posts, rooms, wallets, gifts, pkgs, settings, levelCfg] = await Promise.all([
    getDocs(query(collection(db, 'users'), limit(150))),
    getDocs(query(collection(db, 'posts'), limit(150))),
    getDocs(query(collection(db, 'audioRooms'), limit(100))),
    getDocs(query(collection(db, 'wallets'), limit(150))),
    getDocs(query(collection(db, 'virtualGifts'), limit(60))),
    getDocs(query(collection(db, 'coinPackages'), limit(40))),
    getDoc(doc(db, 'appSettings', 'platform')),
    getDoc(doc(db, 'appSettings', 'levelConfig')),
  ]);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      platform: 'BANDHU MELA',
      appSettings: settings.exists() ? settings.data() : DEFAULT_APP_SETTINGS,
      levelConfig: levelCfg.exists() ? levelCfg.data() : DEFAULT_LEVEL_CONFIG,
      users: users.docs.map((d) => d.data()),
      posts: posts.docs.map((d) => d.data()),
      audioRooms: rooms.docs.map((d) => d.data()),
      wallets: wallets.docs.map((d) => d.data()),
      virtualGifts: gifts.docs.map((d) => d.data()),
      coinPackages: pkgs.docs.map((d) => d.data()),
    },
    null,
    2
  );
}
