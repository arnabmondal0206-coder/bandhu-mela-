import { auth } from './firebase';
import {
  CoinEconomyConfig,
  EconomyUserStatus,
  PromotionalLedgerEntry,
  PromotionalPool,
} from '../types/social';

export interface OwnerEconomyOverview {
  config: CoinEconomyConfig;
  pool: PromotionalPool;
  promotionalLedger: PromotionalLedgerEntry[];
  gateway: {
    stripeEnabled: boolean;
    razorpayEnabled: boolean;
    ownerApprovalEnabled: boolean;
  };
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Please sign in first.');
  }
  const idToken = await user.getIdToken();
  return {
    Authorization: `Bearer ${idToken}`,
    'Content-Type': 'application/json',
  };
}

async function parseJsonOrThrow<T>(resp: Response, fallbackMsg: string): Promise<T> {
  const payload = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) {
    throw new Error(payload?.error || `${fallbackMsg} (HTTP ${resp.status})`);
  }
  return payload;
}

export async function fetchEconomyStatusUser(): Promise<EconomyUserStatus> {
  const headers = await getAuthHeaders();
  const resp = await fetch('/api/economy/my-status', { method: 'GET', headers });
  return parseJsonOrThrow<EconomyUserStatus>(resp, 'Unable to load coin economy status');
}

export async function claimPeriodicBonusUser(bonusType: 'daily' | 'weekly' | 'monthly'): Promise<{
  success: boolean;
  bonusType: 'daily' | 'weekly' | 'monthly';
  coinsAwarded: number;
  transactionId: string;
  newBalance: number;
}> {
  const headers = await getAuthHeaders();
  const resp = await fetch('/api/economy/claim-bonus', {
    method: 'POST',
    headers,
    body: JSON.stringify({ bonusType }),
  });
  return parseJsonOrThrow(resp, 'Unable to claim bonus');
}

export async function sendSpeakingRewardHeartbeat(params: {
  roomId: string;
  activeSeconds: number;
}): Promise<{
  awardedCoins: number;
  speakingCarrySeconds: number;
  speakingDailyCoinsEarned: number;
  skippedReason?: string;
}> {
  const headers = await getAuthHeaders();
  const resp = await fetch('/api/economy/speaking-heartbeat', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow(resp, 'Unable to sync speaking reward');
}

export async function sendHostingRewardHeartbeat(params: {
  roomId: string;
  activeSeconds: number;
}): Promise<{
  awardedCoins: number;
  hostingCarrySeconds: number;
  hostingDailyCoinsEarned: number;
  hostingMonthlyCoinsEarned: number;
  skippedReason?: string;
}> {
  const headers = await getAuthHeaders();
  const resp = await fetch('/api/economy/hosting-heartbeat', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow(resp, 'Unable to sync hosting bonus');
}

export async function fetchOwnerEconomyOverview(): Promise<OwnerEconomyOverview> {
  const headers = await getAuthHeaders();
  const resp = await fetch('/api/owner/economy/overview', { method: 'GET', headers });
  return parseJsonOrThrow<OwnerEconomyOverview>(resp, 'Unable to load Owner coin economy overview');
}

export async function saveOwnerEconomyConfig(
  config: Partial<CoinEconomyConfig>
): Promise<{ success: boolean; config: CoinEconomyConfig }> {
  const headers = await getAuthHeaders();
  const resp = await fetch('/api/owner/economy/config', {
    method: 'PUT',
    headers,
    body: JSON.stringify(config),
  });
  return parseJsonOrThrow(resp, 'Unable to save coin economy rules');
}

export async function updateOwnerPromoPool(payload: {
  action: 'issue_budget' | 'set_paused' | 'update_limits' | 'manual_promo_grant';
  amount?: number;
  paused?: boolean;
  perUserDailyCap?: number;
  perUserMonthlyCap?: number;
  maxSingleReward?: number;
  targetUid?: string;
  note?: string;
}): Promise<{ success: boolean; pool?: PromotionalPool; coinsGranted?: number }> {
  const headers = await getAuthHeaders();
  const resp = await fetch('/api/owner/economy/promo-pool', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(resp, 'Unable to update promotional reward pool');
}

export async function syncApprovedCoinPackagesOwner(): Promise<{
  success: boolean;
  packages: Array<{ id: string; name: string; coins: number; bonusCoins: number; priceInr: number; priceUsd: number; active: boolean }>;
}> {
  const headers = await getAuthHeaders();
  const resp = await fetch('/api/owner/coins/sync-approved-packages', {
    method: 'POST',
    headers,
  });
  return parseJsonOrThrow(resp, 'Unable to sync approved INR Coin Store packages');
}
