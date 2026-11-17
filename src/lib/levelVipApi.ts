import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { LevelConfig, LevelTier, SpeakingMonthHistory, SpeakingStats } from '../types/social';
import { db } from './firebase';

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

export function getMonthlyResetCountdown(now = new Date()): {
  days: number;
  hours: number;
  resetLabel: string;
} {
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

export function subscribeMySpeakingStats(
  uid: string,
  onData: (stats: SpeakingStats | null) => void
): () => void {
  return onSnapshot(
    doc(db, 'speakingStats', uid),
    (snap) => onData(snap.exists() ? (snap.data() as SpeakingStats) : null),
    () => onData(null)
  );
}

export function subscribeAllSpeakingStatsMap(
  onData: (map: Record<string, SpeakingStats>) => void
): () => void {
  return onSnapshot(
    query(collection(db, 'speakingStats'), limit(200)),
    (snap) => {
      const map: Record<string, SpeakingStats> = {};
      const currentMonth = getCurrentMonthKey();
      const nowMs = Date.now();
      snap.docs.forEach((d) => {
        const s = d.data() as SpeakingStats;
        // Expired months display as 0 monthly seconds until the user resets on next heartbeat/login
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

export function subscribeSpeakingHistory(
  uid: string,
  onData: (items: SpeakingMonthHistory[]) => void
): () => void {
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

/**
 * Checks whether the stored speakingStats document belongs to a past month.
 * If so, archives the completed month into speakingStats/{uid}/history/{oldMonthKey}
 * and resets monthlySeconds to 0 for the fresh 1st-of-month cycle.
 */
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

  // Archive completed month before resetting to 0
  const oldSummary = computeLevelSummary({ ...prev, cycleEndsAt: Date.now() + 60000 }, config);
  const historyRef = doc(db, 'speakingStats', uid, 'history', prev.monthKey);
  await setDoc(historyRef, {
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

/**
 * Records verified active speaking seconds (strictly capped <= 25s per heartbeat)
 * while unmuted, seated on stage, app foregrounded, and microphone voice activity detected.
 */
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
