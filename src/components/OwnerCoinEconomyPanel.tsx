import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Coins,
  CreditCard,
  Gift,
  History,
  Loader2,
  Mic,
  PauseCircle,
  PlayCircle,
  Plus,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Vault,
  Wallet,
} from 'lucide-react';
import {
  adjustUserWalletOwner,
  DEFAULT_COIN_PACKAGES,
  DEFAULT_VIRTUAL_GIFTS,
  deleteCoinPackage,
  deleteVirtualGift,
  LEGACY_COIN_PACKAGE_IDS,
  reviewCoinTopupRequestOwner,
  saveCoinPackage,
  saveVirtualGift,
} from '../lib/audioPartyApi';
import {
  fetchOwnerEconomyOverview,
  saveOwnerEconomyConfig,
  syncApprovedCoinPackagesOwner,
  updateOwnerPromoPool,
} from '../lib/economyApi';
import { formatRelativeTime, makeId } from '../lib/socialApi';
import {
  CoinEconomyConfig,
  CoinPackage,
  CoinTopupRequest,
  CoinTransaction,
  PromotionalLedgerEntry,
  PromotionalPool,
  UserProfile,
  UserWallet,
  VirtualGift,
} from '../types/social';

export type EconomySubTab =
  | 'pricing'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'speaking'
  | 'hosting'
  | 'promotional'
  | 'gifts'
  | 'wallets'
  | 'transactions';

interface OwnerCoinEconomyPanelProps {
  currentUser: UserProfile;
  users: UserProfile[];
  gifts: VirtualGift[];
  coinPackages: CoinPackage[];
  wallets: UserWallet[];
  transactions: CoinTransaction[];
  topupRequests: CoinTopupRequest[];
  onRefreshParent: () => Promise<void> | void;
  onAudit: (action: string, targetType: string, targetId: string, details: string) => Promise<void>;
  onToast: (msg: string) => void;
}

const DEFAULT_CONFIG_STATE: CoinEconomyConfig = {
  id: 'coinEconomy',
  dailyBonusEnabled: true,
  dailyBonusCoins: 10,
  weeklyBonusEnabled: true,
  weeklyBonusCoins: 60,
  weeklyBonusWeekdayUtc: -1,
  weeklyMinSpeakingMinutes: 0,
  monthlyBonusEnabled: true,
  monthlyBonusCoins: 200,
  monthlyBonusDayOfMonth: 1,
  monthlyMinSpeakingMinutes: 0,
  monthlyMinLevel: 0,
  speakingRewardEnabled: true,
  speakingMinutesPerReward: 15,
  speakingRewardCoins: 5,
  speakingDailyMaxCoins: 50,
  hostingBonusEnabled: true,
  hostingRateMode: 'per_minute',
  hostingCoinsPerUnit: 2,
  hostingMinListeners: 1,
  hostingDailyMaxCoins: 120,
  hostingMonthlyMaxCoins: 1500,
  updatedBy: '',
};

export const OwnerCoinEconomyPanel: React.FC<OwnerCoinEconomyPanelProps> = ({
  currentUser,
  users,
  gifts,
  coinPackages,
  wallets,
  transactions,
  topupRequests,
  onRefreshParent,
  onAudit,
  onToast,
}) => {
  const [subTab, setSubTab] = useState<EconomySubTab>('pricing');
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [poolBusy, setPoolBusy] = useState(false);

  const [configDraft, setConfigDraft] = useState<CoinEconomyConfig>(DEFAULT_CONFIG_STATE);
  const [pool, setPool] = useState<PromotionalPool | null>(null);
  const [promoLedger, setPromoLedger] = useState<PromotionalLedgerEntry[]>([]);
  const [gateway, setGateway] = useState({
    stripeEnabled: false,
    razorpayEnabled: false,
    ownerApprovalEnabled: true,
  });

  // Coin Packages draft
  const [newPkgName, setNewPkgName] = useState('');
  const [newPkgCoins, setNewPkgCoins] = useState('100');
  const [newPkgBonus, setNewPkgBonus] = useState('0');
  const [newPkgInr, setNewPkgInr] = useState('10');
  const [newPkgUsd, setNewPkgUsd] = useState('0.12');
  const [editingPkgPrices, setEditingPkgPrices] = useState<Record<string, string>>({});
  const [syncingPackages, setSyncingPackages] = useState(false);

  // Promotional Pool controls
  const [issueAmount, setIssueAmount] = useState('5000');
  const [issueNote, setIssueNote] = useState('Owner Promotional Reserve Allocation');
  const [dailyCapDraft, setDailyCapDraft] = useState('500');
  const [monthlyCapDraft, setMonthlyCapDraft] = useState('5000');
  const [maxSingleDraft, setMaxSingleDraft] = useState('1000');
  const [promoGrantUid, setPromoGrantUid] = useState('');
  const [promoGrantAmount, setPromoGrantAmount] = useState('50');
  const [promoGrantNote, setPromoGrantNote] = useState('Owner Promotional Bonus');

  // Virtual Gift controls
  const [newGiftName, setNewGiftName] = useState('');
  const [newGiftEmoji, setNewGiftEmoji] = useState('🎁');
  const [newGiftPrice, setNewGiftPrice] = useState('50');
  const [newGiftAnim, setNewGiftAnim] = useState<VirtualGift['animationType']>('burst');
  const [editingGiftPrices, setEditingGiftPrices] = useState<Record<string, string>>({});

  // Wallet adjustment & filters
  const [walletAdjustUid, setWalletAdjustUid] = useState('');
  const [walletAdjustDelta, setWalletAdjustDelta] = useState('100');
  const [walletAdjustNote, setWalletAdjustNote] = useState('Owner manual wallet adjustment');
  const [txFilter, setTxFilter] = useState<'all' | 'purchased' | 'promotional' | 'gifts'>('all');

  const userByUid = useMemo(() => {
    const map = new Map<string, UserProfile>();
    users.forEach((u) => map.set(u.uid, u));
    return map;
  }, [users]);

  const loadEconomyOverview = async () => {
    setLoading(true);
    try {
      const overview = await fetchOwnerEconomyOverview();
      setConfigDraft(overview.config);
      setPool(overview.pool);
      setPromoLedger(overview.promotionalLedger);
      setGateway(overview.gateway);
      setDailyCapDraft(String(overview.pool.perUserDailyCap));
      setMonthlyCapDraft(String(overview.pool.perUserMonthlyCap));
      setMaxSingleDraft(String(overview.pool.maxSingleReward));
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to load coin economy overview');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEconomyOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveEconomyConfig = async (label: string) => {
    setSavingConfig(true);
    try {
      const resp = await saveOwnerEconomyConfig(configDraft);
      setConfigDraft(resp.config);
      onToast(`${label} settings saved and live immediately.`);
      void loadEconomyOverview();
    } catch (err) {
      onToast(err instanceof Error ? err.message : `Failed to save ${label}`);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleIssuePromoBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    setPoolBusy(true);
    try {
      await updateOwnerPromoPool({
        action: 'issue_budget',
        amount: Math.floor(Number(issueAmount) || 0),
        note: issueNote,
      });
      onToast(`Added +${issueAmount} coins to Promotional Reward Pool budget.`);
      await loadEconomyOverview();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to issue budget');
    } finally {
      setPoolBusy(false);
    }
  };

  const handleTogglePoolPause = async () => {
    if (!pool) return;
    setPoolBusy(true);
    try {
      await updateOwnerPromoPool({ action: 'set_paused', paused: !pool.paused });
      onToast(!pool.paused ? 'Promotional reward payouts paused.' : 'Promotional reward payouts resumed.');
      await loadEconomyOverview();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to update pool status');
    } finally {
      setPoolBusy(false);
    }
  };

  const handleSavePoolLimits = async () => {
    setPoolBusy(true);
    try {
      await updateOwnerPromoPool({
        action: 'update_limits',
        perUserDailyCap: Math.floor(Number(dailyCapDraft) || 0),
        perUserMonthlyCap: Math.floor(Number(monthlyCapDraft) || 0),
        maxSingleReward: Math.floor(Number(maxSingleDraft) || 100),
      });
      onToast('Promotional pool safety caps updated.');
      await loadEconomyOverview();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to update caps');
    } finally {
      setPoolBusy(false);
    }
  };

  const handleManualPromoGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = promoGrantUid || users[0]?.uid;
    if (!target) {
      onToast('Select a registered user first.');
      return;
    }
    setPoolBusy(true);
    try {
      const resp = await updateOwnerPromoPool({
        action: 'manual_promo_grant',
        targetUid: target,
        amount: Math.floor(Number(promoGrantAmount) || 0),
        note: promoGrantNote,
      });
      onToast(`Granted ${resp.coinsGranted || promoGrantAmount} promotional coins (recorded in Promotional Ledger).`);
      await loadEconomyOverview();
      await onRefreshParent();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to grant promotional coins');
    } finally {
      setPoolBusy(false);
    }
  };

  const handleCreatePackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPkgName.trim()) return;
    const coins = Math.max(1, Math.round(Number(newPkgCoins) || 100));
    const bonusCoins = Math.max(0, Math.round(Number(newPkgBonus) || 0));
    const priceInr = Math.max(1, Math.round(Number(newPkgInr) || 10));
    const priceUsd = Number((priceInr / 83.5).toFixed(2)) || Number(newPkgUsd) || 0.12;
    const id = makeId('pkg');
    await saveCoinPackage({
      id,
      name: newPkgName.trim(),
      coins,
      bonusCoins,
      priceInr,
      priceUsd,
      active: true,
    });
    await onAudit('create_coin_package', 'coinPackage', id, `${newPkgName.trim()} (${coins}c + ${bonusCoins} bonus = ₹${priceInr})`);
    setNewPkgName('');
    onToast('Coin package saved.');
  };

  const handleCreateGift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGiftName.trim()) return;
    const id = makeId('gift');
    await saveVirtualGift({
      id,
      name: newGiftName.trim(),
      emoji: newGiftEmoji.trim() || '🎁',
      category: newGiftAnim === 'crown' || newGiftAnim === 'couple_love' ? 'royal' : 'celebration',
      coinPrice: Math.max(1, Number(newGiftPrice) || 50),
      animationType: newGiftAnim,
      active: true,
    });
    await onAudit('create_virtual_gift', 'virtualGift', id, `${newGiftName} (${newGiftPrice} coins)`);
    setNewGiftName('');
    onToast('Virtual gift added to catalog.');
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (txFilter === 'all') return true;
      if (txFilter === 'purchased') return tx.type === 'purchase' || tx.coinSource === 'purchased';
      if (txFilter === 'promotional') {
        return (
          tx.coinSource === 'promotional' ||
          tx.type === 'daily_bonus' ||
          tx.type === 'weekly_bonus' ||
          tx.type === 'monthly_bonus' ||
          tx.type === 'speaking_reward' ||
          tx.type === 'hosting_reward' ||
          tx.type === 'promo_bonus' ||
          tx.type === 'starter'
        );
      }
      return tx.type === 'gift_sent' || tx.type === 'gift_received';
    });
  }, [transactions, txFilter]);

  const sections: { id: EconomySubTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'pricing', label: 'Coin Pricing', icon: CreditCard },
    { id: 'daily', label: 'Daily Bonus', icon: Award },
    { id: 'weekly', label: 'Weekly Bonus', icon: Calendar },
    { id: 'monthly', label: 'Monthly Bonus', icon: CalendarDays },
    { id: 'speaking', label: 'Speaking Rewards', icon: Mic },
    { id: 'hosting', label: 'Hosting Bonus', icon: Radio },
    { id: 'promotional', label: 'Promotional Pool', icon: Vault },
    { id: 'gifts', label: 'Gift Pricing', icon: Gift },
    { id: 'wallets', label: 'User Wallets', icon: Wallet },
    { id: 'transactions', label: 'Transaction History', icon: History },
  ];

  const totalPurchasedWallets = wallets.reduce((s, w) => s + (w.totalPurchased || 0), 0);
  const totalPromoWallets = wallets.reduce((s, w) => s + (w.totalPromotionalEarned || 0), 0);

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-display text-base font-bold flex items-center gap-2">
            <Coins className="w-5 h-5 text-amber-500" />
            <span>Original Owner Coin Economy Control Center</span>
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Backend-validated rewards, separate Promotional Ledger, and live Pricing controls locked to Original Owner UID.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadEconomyOverview()}
          className="h-9 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Sync Economy</span>
        </button>
      </div>

      {/* 10-Section Sub-Navigation */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {sections.map((item) => {
          const Icon = item.icon;
          const active = subTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSubTab(item.id)}
              className={`h-9 px-3.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer ${
                active
                  ? 'bg-[#0D6E6E] text-white'
                  : 'bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] text-zinc-700 dark:text-zinc-300'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* 1. COIN PRICING */}
      {subTab === 'pricing' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 flex items-start gap-3">
            {gateway.stripeEnabled || gateway.razorpayEnabled ? (
              <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            )}
            <div className="text-xs space-y-1">
              <p className="font-bold">
                Payment Gateway Status:{' '}
                {gateway.stripeEnabled
                  ? 'Stripe Live'
                  : gateway.razorpayEnabled
                  ? 'Razorpay Live'
                  : 'No Live Payment Gateway Configured (Owner Order Verification Mode)'}
              </p>
              <p className="text-zinc-500">
                Real card/UPI payments remain inactive until STRIPE_SECRET_KEY or RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET are configured and verified on the backend. Orders below require verified Owner approval before crediting Purchased Coins.
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-display text-sm font-bold">Coin Store Packages (INR ₹)</h4>
                <p className="text-[11px] text-zinc-500">
                  Official packages: 100=₹10, 500=₹49, 1,000=₹99, 5,000=₹399, 10,000=₹799 (no unauthorized bonus coins). Only Original Owner can edit prices.
                </p>
              </div>
              <button
                type="button"
                disabled={syncingPackages}
                onClick={async () => {
                  setSyncingPackages(true);
                  try {
                    await syncApprovedCoinPackagesOwner();
                    await onRefreshParent();
                    onToast('Synced 5 official INR Coin Store packages & removed legacy packages.');
                  } catch {
                    for (const legacyId of LEGACY_COIN_PACKAGE_IDS) {
                      await deleteCoinPackage(legacyId).catch(() => {});
                    }
                    for (const pkg of DEFAULT_COIN_PACKAGES) {
                      await saveCoinPackage(pkg);
                    }
                    await onAudit(
                      'sync_approved_coin_packages',
                      'coinPackages',
                      'catalog',
                      'Synced 5 official INR packages (100=₹10..10000=₹799) & deleted legacy packages'
                    );
                    onToast('5 official INR Coin Store packages synced.');
                  } finally {
                    setSyncingPackages(false);
                  }
                }}
                className="h-9 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                {syncingPackages && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Sync 5 Official ₹ Packages</span>
              </button>
            </div>

            <form onSubmit={handleCreatePackage} className="grid grid-cols-2 sm:grid-cols-6 gap-2">
              <input
                type="text"
                required
                value={newPkgName}
                onChange={(e) => setNewPkgName(e.target.value)}
                placeholder="Package Name"
                className="h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs sm:col-span-2"
              />
              <input
                type="number"
                min={1}
                value={newPkgCoins}
                onChange={(e) => setNewPkgCoins(e.target.value)}
                placeholder="Coins"
                className="h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs"
              />
              <input
                type="number"
                min={0}
                value={newPkgBonus}
                onChange={(e) => setNewPkgBonus(e.target.value)}
                placeholder="Bonus (0)"
                className="h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs"
              />
              <input
                type="number"
                min={1}
                value={newPkgInr}
                onChange={(e) => setNewPkgInr(e.target.value)}
                placeholder="Price INR ₹"
                className="h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs"
              />
              <button
                type="submit"
                className="h-10 px-4 rounded-xl bg-amber-500 text-zinc-950 text-xs font-bold cursor-pointer"
              >
                Add Package
              </button>
            </form>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {coinPackages.map((pkg) => {
                const draftInr = editingPkgPrices[pkg.id] ?? String(pkg.priceInr);
                return (
                  <div
                    key={pkg.id}
                    className="rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] p-3.5 space-y-2.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-bold">
                          {pkg.name} ({pkg.coins.toLocaleString('en-IN')} Coins)
                        </p>
                        <p className="text-zinc-500 tabular-nums">
                          Price: ₹{pkg.priceInr.toLocaleString('en-IN')} INR
                          {pkg.bonusCoins > 0 ? ` · +${pkg.bonusCoins.toLocaleString('en-IN')} bonus` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={async () => {
                            await saveCoinPackage({ ...pkg, active: !pkg.active });
                            await onAudit('toggle_coin_package', 'coinPackage', pkg.id, `${pkg.name} active=${!pkg.active}`);
                            onToast(`${pkg.name} ${!pkg.active ? 'activated' : 'paused'}.`);
                          }}
                          className={`h-8 px-2.5 rounded-lg border font-semibold cursor-pointer ${
                            pkg.active
                              ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                              : 'border-[#E4DFD5] dark:border-[#262C30] text-zinc-500'
                          }`}
                        >
                          {pkg.active ? 'Active' : 'Paused'}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteCoinPackage(pkg.id);
                            await onAudit('delete_coin_package', 'coinPackage', pkg.id, pkg.name);
                          }}
                          className="w-8 h-8 rounded-lg text-red-600 flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-zinc-500 font-bold">₹</span>
                      <input
                        type="number"
                        min={1}
                        value={draftInr}
                        onChange={(e) => setEditingPkgPrices((p) => ({ ...p, [pkg.id]: e.target.value }))}
                        className="flex-1 min-w-0 h-8 px-2.5 rounded-lg border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs font-semibold tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const nextInr = Math.round(Number(draftInr));
                          if (!Number.isFinite(nextInr) || nextInr < 1) {
                            onToast('Enter a valid INR price (min ₹1).');
                            return;
                          }
                          const nextUsd = Number((nextInr / 83.5).toFixed(2));
                          await saveCoinPackage({ ...pkg, priceInr: nextInr, priceUsd: nextUsd });
                          await onAudit('update_coin_package_price', 'coinPackage', pkg.id, `${pkg.name}: ₹${nextInr}`);
                          onToast(`Updated ${pkg.name} price to ₹${nextInr.toLocaleString('en-IN')}.`);
                        }}
                        className="h-8 px-2.5 rounded-lg bg-[#0D6E6E] text-white font-semibold cursor-pointer"
                      >
                        Save ₹ Price
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 2. DAILY BONUS */}
      {subTab === 'daily' && (
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="font-display text-sm font-bold">Daily Check-In Bonus</h4>
              <p className="text-xs text-zinc-500">
                1 claim per user per UTC day. Funded strictly from the Promotional Reward Pool.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={configDraft.dailyBonusEnabled}
                onChange={(e) => setConfigDraft((p) => ({ ...p, dailyBonusEnabled: e.target.checked }))}
                className="w-4 h-4 accent-[#0D6E6E]"
              />
              <span>{configDraft.dailyBonusEnabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-zinc-500">Daily Bonus Coins</label>
              <input
                type="number"
                min={0}
                max={5000}
                value={configDraft.dailyBonusCoins}
                onChange={(e) =>
                  setConfigDraft((p) => ({ ...p, dailyBonusCoins: Math.max(0, Number(e.target.value) || 0) }))
                }
                className="mt-1 w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm font-semibold tabular-nums"
              />
            </div>
          </div>
          <button
            type="button"
            disabled={savingConfig}
            onClick={() => void handleSaveEconomyConfig('Daily Bonus')}
            className="h-10 px-5 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold flex items-center gap-2 cursor-pointer"
          >
            {savingConfig && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>Save Daily Bonus Settings</span>
          </button>
        </div>
      )}

      {/* 3. WEEKLY BONUS */}
      {subTab === 'weekly' && (
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="font-display text-sm font-bold">Weekly Bonus (Default: 60 Coins)</h4>
              <p className="text-xs text-zinc-500">
                1 claim per ISO week (UTC). Owner controls payout amount, weekday schedule, and speaking eligibility.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={configDraft.weeklyBonusEnabled}
                onChange={(e) => setConfigDraft((p) => ({ ...p, weeklyBonusEnabled: e.target.checked }))}
                className="w-4 h-4 accent-[#0D6E6E]"
              />
              <span>{configDraft.weeklyBonusEnabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-semibold text-zinc-500">Weekly Bonus Coins</label>
              <input
                type="number"
                min={0}
                max={20000}
                value={configDraft.weeklyBonusCoins}
                onChange={(e) =>
                  setConfigDraft((p) => ({ ...p, weeklyBonusCoins: Math.max(0, Number(e.target.value) || 0) }))
                }
                className="mt-1 w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm font-semibold tabular-nums"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-500">Opens On Weekday (UTC)</label>
              <select
                value={configDraft.weeklyBonusWeekdayUtc}
                onChange={(e) =>
                  setConfigDraft((p) => ({ ...p, weeklyBonusWeekdayUtc: Number(e.target.value) }))
                }
                className="mt-1 w-full h-11 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs font-semibold"
              >
                <option value={-1}>Any Day (All Week)</option>
                <option value={1}>Monday+</option>
                <option value={2}>Tuesday+</option>
                <option value={3}>Wednesday+</option>
                <option value={4}>Thursday+</option>
                <option value={5}>Friday+</option>
                <option value={6}>Saturday+</option>
                <option value={0}>Sunday Only</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-500">Min Monthly Speaking Mins</label>
              <input
                type="number"
                min={0}
                max={10080}
                value={configDraft.weeklyMinSpeakingMinutes}
                onChange={(e) =>
                  setConfigDraft((p) => ({
                    ...p,
                    weeklyMinSpeakingMinutes: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="mt-1 w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm font-semibold tabular-nums"
              />
            </div>
          </div>
          <button
            type="button"
            disabled={savingConfig}
            onClick={() => void handleSaveEconomyConfig('Weekly Bonus')}
            className="h-10 px-5 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold cursor-pointer"
          >
            Save Weekly Bonus Settings
          </button>
        </div>
      )}

      {/* 4. MONTHLY BONUS */}
      {subTab === 'monthly' && (
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="font-display text-sm font-bold">Monthly Bonus (Default: 200 Coins)</h4>
              <p className="text-xs text-zinc-500">
                1 claim per UTC month. Owner controls amount, release day of month, speaking mins, and min Level tier.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={configDraft.monthlyBonusEnabled}
                onChange={(e) => setConfigDraft((p) => ({ ...p, monthlyBonusEnabled: e.target.checked }))}
                className="w-4 h-4 accent-[#0D6E6E]"
              />
              <span>{configDraft.monthlyBonusEnabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-semibold text-zinc-500">Monthly Bonus Coins</label>
              <input
                type="number"
                min={0}
                max={100000}
                value={configDraft.monthlyBonusCoins}
                onChange={(e) =>
                  setConfigDraft((p) => ({ ...p, monthlyBonusCoins: Math.max(0, Number(e.target.value) || 0) }))
                }
                className="mt-1 w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm font-semibold tabular-nums"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-500">Day of Month (1–28)</label>
              <input
                type="number"
                min={1}
                max={28}
                value={configDraft.monthlyBonusDayOfMonth}
                onChange={(e) =>
                  setConfigDraft((p) => ({
                    ...p,
                    monthlyBonusDayOfMonth: Math.min(28, Math.max(1, Number(e.target.value) || 1)),
                  }))
                }
                className="mt-1 w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm font-semibold tabular-nums"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-500">Min Speaking Mins</label>
              <input
                type="number"
                min={0}
                max={43200}
                value={configDraft.monthlyMinSpeakingMinutes}
                onChange={(e) =>
                  setConfigDraft((p) => ({
                    ...p,
                    monthlyMinSpeakingMinutes: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="mt-1 w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm font-semibold tabular-nums"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-500">Min User Level (0–5)</label>
              <select
                value={configDraft.monthlyMinLevel}
                onChange={(e) =>
                  setConfigDraft((p) => ({ ...p, monthlyMinLevel: Number(e.target.value) }))
                }
                className="mt-1 w-full h-11 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs font-semibold"
              >
                <option value={0}>Level 0 (All Users)</option>
                <option value={1}>Level 1+ Bronze Speaker</option>
                <option value={2}>Level 2+ Silver Speaker</option>
                <option value={3}>Level 3+ Gold Speaker</option>
                <option value={4}>Level 4+ Platinum Speaker</option>
                <option value={5}>Level 5 Monthly VIP Only</option>
              </select>
            </div>
          </div>
          <button
            type="button"
            disabled={savingConfig}
            onClick={() => void handleSaveEconomyConfig('Monthly Bonus')}
            className="h-10 px-5 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold cursor-pointer"
          >
            Save Monthly Bonus Settings
          </button>
        </div>
      )}

      {/* 5. SPEAKING REWARDS */}
      {subTab === 'speaking' && (
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="font-display text-sm font-bold">Active Speaking Coin Rewards</h4>
              <p className="text-xs text-zinc-500">
                Anti-cheat enforced: only live stage speakers with unmuted mic, real voice RMS amplitude, and foregrounded app earn credit. Muted, idle, and disconnected time is ignored.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={configDraft.speakingRewardEnabled}
                onChange={(e) => setConfigDraft((p) => ({ ...p, speakingRewardEnabled: e.target.checked }))}
                className="w-4 h-4 accent-[#0D6E6E]"
              />
              <span>{configDraft.speakingRewardEnabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-semibold text-zinc-500">Active Speaking Mins per Reward</label>
              <input
                type="number"
                min={1}
                max={240}
                value={configDraft.speakingMinutesPerReward}
                onChange={(e) =>
                  setConfigDraft((p) => ({
                    ...p,
                    speakingMinutesPerReward: Math.max(1, Number(e.target.value) || 1),
                  }))
                }
                className="mt-1 w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm font-semibold tabular-nums"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-500">Coins per Reward Milestone</label>
              <input
                type="number"
                min={0}
                max={1000}
                value={configDraft.speakingRewardCoins}
                onChange={(e) =>
                  setConfigDraft((p) => ({
                    ...p,
                    speakingRewardCoins: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="mt-1 w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm font-semibold tabular-nums"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-500">Daily Max Speaking Coins / User</label>
              <input
                type="number"
                min={0}
                max={10000}
                value={configDraft.speakingDailyMaxCoins}
                onChange={(e) =>
                  setConfigDraft((p) => ({
                    ...p,
                    speakingDailyMaxCoins: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="mt-1 w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm font-semibold tabular-nums"
              />
            </div>
          </div>
          <button
            type="button"
            disabled={savingConfig}
            onClick={() => void handleSaveEconomyConfig('Speaking Rewards')}
            className="h-10 px-5 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold cursor-pointer"
          >
            Save Speaking Reward Rules
          </button>
        </div>
      )}

      {/* 6. HOSTING BONUS */}
      {subTab === 'hosting' && (
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="font-display text-sm font-bold">Verified Audio Room Hosting Bonus</h4>
              <p className="text-xs text-zinc-500">
                Requires live audio room owned by the host with genuine active participants &gt;= minimum threshold.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={configDraft.hostingBonusEnabled}
                onChange={(e) => setConfigDraft((p) => ({ ...p, hostingBonusEnabled: e.target.checked }))}
                className="w-4 h-4 accent-[#0D6E6E]"
              />
              <span>{configDraft.hostingBonusEnabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-semibold text-zinc-500">Payout Rate Unit</label>
              <select
                value={configDraft.hostingRateMode}
                onChange={(e) =>
                  setConfigDraft((p) => ({
                    ...p,
                    hostingRateMode: e.target.value === 'per_hour' ? 'per_hour' : 'per_minute',
                  }))
                }
                className="mt-1 w-full h-11 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs font-semibold"
              >
                <option value="per_minute">Coins Per Minute</option>
                <option value="per_hour">Coins Per Hour</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-500">
                Coins Per {configDraft.hostingRateMode === 'per_hour' ? 'Hour' : 'Minute'}
              </label>
              <input
                type="number"
                min={0}
                max={5000}
                value={configDraft.hostingCoinsPerUnit}
                onChange={(e) =>
                  setConfigDraft((p) => ({
                    ...p,
                    hostingCoinsPerUnit: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="mt-1 w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm font-semibold tabular-nums"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-500">Min Room Participants Required</label>
              <input
                type="number"
                min={1}
                max={500}
                value={configDraft.hostingMinListeners}
                onChange={(e) =>
                  setConfigDraft((p) => ({
                    ...p,
                    hostingMinListeners: Math.max(1, Number(e.target.value) || 1),
                  }))
                }
                className="mt-1 w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm font-semibold tabular-nums"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-500">Daily Host Limit (Coins)</label>
              <input
                type="number"
                min={0}
                max={20000}
                value={configDraft.hostingDailyMaxCoins}
                onChange={(e) =>
                  setConfigDraft((p) => ({
                    ...p,
                    hostingDailyMaxCoins: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="mt-1 w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm font-semibold tabular-nums"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-500">Monthly Host Limit (Coins)</label>
              <input
                type="number"
                min={0}
                max={200000}
                value={configDraft.hostingMonthlyMaxCoins}
                onChange={(e) =>
                  setConfigDraft((p) => ({
                    ...p,
                    hostingMonthlyMaxCoins: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="mt-1 w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm font-semibold tabular-nums"
              />
            </div>
          </div>
          <button
            type="button"
            disabled={savingConfig}
            onClick={() => void handleSaveEconomyConfig('Hosting Bonus')}
            className="h-10 px-5 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold cursor-pointer"
          >
            Save Hosting Bonus Rules
          </button>
        </div>
      )}

      {/* 7. PROMOTIONAL POOL */}
      {subTab === 'promotional' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Total Issued Budget', value: pool?.issuedBudget ?? 0, tone: 'text-zinc-900 dark:text-white' },
              { label: 'Distributed Rewards', value: pool?.distributedCoins ?? 0, tone: 'text-amber-600 dark:text-amber-400' },
              { label: 'Remaining Pool Budget', value: pool?.remainingBudget ?? 0, tone: 'text-[#0D6E6E] dark:text-teal-400' },
              { label: 'Pool Status', value: pool?.paused ? 'PAUSED' : 'ACTIVE', tone: pool?.paused ? 'text-rose-600' : 'text-emerald-600' },
            ].map((card) => (
              <div
                key={card.label}
                className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-2xl p-4"
              >
                <p className="text-[11px] font-semibold text-zinc-500">{card.label}</p>
                <p className={`font-display text-2xl font-bold tabular-nums mt-1 ${card.tone}`}>
                  {card.value}
                </p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <form
              onSubmit={handleIssuePromoBudget}
              className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-display text-sm font-bold">Issue Promotional Budget</h4>
                <button
                  type="button"
                  disabled={poolBusy}
                  onClick={() => void handleTogglePoolPause()}
                  className={`h-8 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                    pool?.paused
                      ? 'bg-emerald-600 text-white'
                      : 'border border-rose-300 text-rose-600'
                  }`}
                >
                  {pool?.paused ? <PlayCircle className="w-3.5 h-3.5" /> : <PauseCircle className="w-3.5 h-3.5" />}
                  <span>{pool?.paused ? 'Resume Rewards' : 'Pause All Rewards'}</span>
                </button>
              </div>
              <input
                type="number"
                min={1}
                value={issueAmount}
                onChange={(e) => setIssueAmount(e.target.value)}
                placeholder="Coins to add to promo reserve"
                className="w-full h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs font-semibold"
              />
              <input
                type="text"
                value={issueNote}
                onChange={(e) => setIssueNote(e.target.value)}
                placeholder="Audit reason"
                className="w-full h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs"
              />
              <button
                type="submit"
                disabled={poolBusy}
                className="h-10 px-4 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold cursor-pointer"
              >
                Add Budget to Promotional Pool
              </button>
            </form>

            <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-3">
              <h4 className="font-display text-sm font-bold">Promotional Safety Caps</h4>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-zinc-500">Per-User Daily</label>
                  <input
                    type="number"
                    min={0}
                    value={dailyCapDraft}
                    onChange={(e) => setDailyCapDraft(e.target.value)}
                    className="mt-1 w-full h-10 px-2.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-zinc-500">Per-User Monthly</label>
                  <input
                    type="number"
                    min={0}
                    value={monthlyCapDraft}
                    onChange={(e) => setMonthlyCapDraft(e.target.value)}
                    className="mt-1 w-full h-10 px-2.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-zinc-500">Max Single Reward</label>
                  <input
                    type="number"
                    min={1}
                    value={maxSingleDraft}
                    onChange={(e) => setMaxSingleDraft(e.target.value)}
                    className="mt-1 w-full h-10 px-2.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs font-semibold"
                  />
                </div>
              </div>
              <button
                type="button"
                disabled={poolBusy}
                onClick={() => void handleSavePoolLimits()}
                className="h-10 px-4 rounded-xl bg-amber-500 text-zinc-950 text-xs font-bold cursor-pointer"
              >
                Save Promotional Pool Caps
              </button>
            </div>
          </div>

          <form
            onSubmit={handleManualPromoGrant}
            className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-3"
          >
            <h4 className="font-display text-sm font-bold">
              Direct Promotional Coin Grant (Audited — Does Not Create Purchased Coins)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <select
                value={promoGrantUid || users[0]?.uid || ''}
                onChange={(e) => setPromoGrantUid(e.target.value)}
                className="h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs"
              >
                {users.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {u.displayName} (@{u.username})
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={promoGrantAmount}
                onChange={(e) => setPromoGrantAmount(e.target.value)}
                placeholder="Promo Coins"
                className="h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs"
              />
              <input
                type="text"
                value={promoGrantNote}
                onChange={(e) => setPromoGrantNote(e.target.value)}
                placeholder="Campaign / Event note"
                className="h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs"
              />
              <button
                type="submit"
                disabled={poolBusy}
                className="h-10 px-4 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold cursor-pointer"
              >
                Grant Promotional Coins
              </button>
            </div>
          </form>

          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-3">
            <h4 className="font-display text-sm font-bold">
              Auditable Promotional Coin Ledger ({promoLedger.length})
            </h4>
            {promoLedger.length === 0 ? (
              <p className="text-xs text-zinc-500">No promotional ledger entries recorded yet.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {promoLedger.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-[#E4DFD5] dark:border-[#262C30] px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-bold truncate">
                        [{entry.entryType}] {entry.note}
                      </p>
                      <p className="text-[11px] text-zinc-500 truncate">
                        Target: {entry.username || entry.userId} · Remaining Pool: {entry.remainingAfter}c
                      </p>
                    </div>
                    <span
                      className={`font-bold tabular-nums shrink-0 ${
                        entry.entryType === 'budget_issued'
                          ? 'text-emerald-600'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {entry.entryType === 'budget_issued'
                        ? `+${entry.budgetImpact} budget`
                        : entry.coinsDelta > 0
                        ? `-${entry.coinsDelta} pool (+user)`
                        : 'status'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 8. GIFT PRICING */}
      {subTab === 'gifts' && (
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-display text-sm font-bold flex items-center gap-1.5">
              <Gift className="w-4 h-4 text-amber-500" />
              <span>Virtual Gifts &amp; Pricing ({gifts.length})</span>
            </h4>
            <button
              type="button"
              onClick={async () => {
                for (const g of DEFAULT_VIRTUAL_GIFTS) {
                  await saveVirtualGift(g);
                }
                await onAudit('seed_default_gifts', 'virtualGift', 'catalog', `Synced ${DEFAULT_VIRTUAL_GIFTS.length} gifts`);
                onToast(`Synced all ${DEFAULT_VIRTUAL_GIFTS.length} default gifts!`);
              }}
              className="h-9 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold cursor-pointer"
            >
              Sync Default 8 Gifts
            </button>
          </div>

          <form onSubmit={handleCreateGift} className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <input
              type="text"
              required
              value={newGiftName}
              onChange={(e) => setNewGiftName(e.target.value)}
              placeholder="Gift Name"
              className="h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs"
            />
            <input
              type="text"
              required
              value={newGiftEmoji}
              onChange={(e) => setNewGiftEmoji(e.target.value)}
              placeholder="Emoji"
              className="h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs"
            />
            <input
              type="number"
              min={1}
              value={newGiftPrice}
              onChange={(e) => setNewGiftPrice(e.target.value)}
              placeholder="Coins"
              className="h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs"
            />
            <select
              value={newGiftAnim}
              onChange={(e) => setNewGiftAnim(e.target.value as VirtualGift['animationType'])}
              className="h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs"
            >
              <option value="float">Float</option>
              <option value="burst">Burst</option>
              <option value="crown">Crown</option>
              <option value="sparkle">Sparkle</option>
              <option value="couple_love">Love Couple Full-Screen</option>
            </select>
            <button
              type="submit"
              className="h-10 px-4 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Gift</span>
            </button>
          </form>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {gifts.map((g) => {
              const draftPrice = editingGiftPrices[g.id] ?? String(g.coinPrice);
              const isCouple = g.id === 'gift_love_couple' || g.animationType === 'couple_love';
              return (
                <div
                  key={g.id}
                  className={`rounded-2xl border p-3.5 space-y-2.5 text-xs ${
                    isCouple
                      ? 'border-rose-400/60 bg-rose-500/5'
                      : 'border-[#E4DFD5] dark:border-[#262C30]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-2xl shrink-0">{g.emoji}</span>
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{g.name}</p>
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 font-bold tabular-nums">
                          {g.coinPrice} coins · {g.animationType}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          await saveVirtualGift({ ...g, active: !g.active });
                          await onAudit('toggle_gift', 'virtualGift', g.id, `${g.name} active=${!g.active}`);
                          onToast(`${g.name} ${!g.active ? 'enabled' : 'disabled'}`);
                        }}
                        className={`h-8 px-2.5 rounded-lg border font-semibold cursor-pointer ${
                          g.active
                            ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-zinc-400/50 text-zinc-500'
                        }`}
                      >
                        {g.active ? 'Active' : 'Off'}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteVirtualGift(g.id);
                          await onAudit('delete_gift', 'virtualGift', g.id, g.name);
                        }}
                        className="w-8 h-8 rounded-lg text-red-600 flex items-center justify-center cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      value={draftPrice}
                      onChange={(e) => setEditingGiftPrices((p) => ({ ...p, [g.id]: e.target.value }))}
                      className="flex-1 min-w-0 h-8 px-2.5 rounded-lg border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs font-semibold tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const nextPrice = Math.floor(Number(draftPrice));
                        if (!Number.isFinite(nextPrice) || nextPrice < 1) {
                          onToast('Enter a valid coin price (min 1).');
                          return;
                        }
                        await saveVirtualGift({ ...g, coinPrice: nextPrice });
                        await onAudit('update_gift_price', 'virtualGift', g.id, `${g.name}: ${nextPrice} coins`);
                        onToast(`Updated ${g.name} price to ${nextPrice} coins.`);
                      }}
                      className="h-8 px-2.5 rounded-lg bg-[#0D6E6E] text-white font-semibold cursor-pointer"
                    >
                      Save Price
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 9. USER WALLETS */}
      {subTab === 'wallets' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-2xl p-4">
              <p className="text-[11px] font-semibold text-zinc-500">Total User Wallets</p>
              <p className="font-display text-xl font-bold tabular-nums mt-1">{wallets.length}</p>
            </div>
            <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-2xl p-4">
              <p className="text-[11px] font-semibold text-zinc-500">Purchased Coins Total</p>
              <p className="font-display text-xl font-bold text-[#0D6E6E] tabular-nums mt-1">{totalPurchasedWallets}</p>
            </div>
            <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-2xl p-4">
              <p className="text-[11px] font-semibold text-zinc-500">Promotional Coins Total</p>
              <p className="font-display text-xl font-bold text-amber-600 tabular-nums mt-1">{totalPromoWallets}</p>
            </div>
            <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-2xl p-4">
              <p className="text-[11px] font-semibold text-zinc-500">Circulating Balance</p>
              <p className="font-display text-xl font-bold tabular-nums mt-1">
                {wallets.reduce((s, w) => s + (w.coinsBalance || 0), 0)}
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-3">
            <h4 className="font-display text-sm font-bold">Owner Direct Wallet Adjustment</h4>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <select
                value={walletAdjustUid || users[0]?.uid || ''}
                onChange={(e) => setWalletAdjustUid(e.target.value)}
                className="h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs"
              >
                {users.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {u.displayName} (@{u.username})
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={walletAdjustDelta}
                onChange={(e) => setWalletAdjustDelta(e.target.value)}
                placeholder="Coins (+/-)"
                className="h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs"
              />
              <input
                type="text"
                value={walletAdjustNote}
                onChange={(e) => setWalletAdjustNote(e.target.value)}
                placeholder="Reason"
                className="h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs"
              />
              <button
                type="button"
                onClick={async () => {
                  const target = walletAdjustUid || users[0]?.uid;
                  if (!target) return;
                  await adjustUserWalletOwner({
                    ownerActor: currentUser,
                    targetUid: target,
                    deltaCoins: Number(walletAdjustDelta) || 0,
                    note: walletAdjustNote,
                  });
                  onToast('Wallet balance updated.');
                  await onRefreshParent();
                }}
                className="h-10 px-4 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold cursor-pointer"
              >
                Apply Adjustment
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-2.5">
            <h4 className="font-display text-sm font-bold">
              Wallet Breakdown ({wallets.length}) — Purchased vs Promotional Coins
            </h4>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {wallets.map((w) => {
                const u = userByUid.get(w.uid);
                return (
                  <div
                    key={w.uid}
                    className="rounded-xl border border-[#E4DFD5] dark:border-[#262C30] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <p className="font-bold">
                        {u ? `${u.displayName} (@${u.username})` : w.uid}
                      </p>
                      <p className="text-[11px] text-zinc-500 tabular-nums">
                        Purchased: {w.totalPurchased ?? 0}c · Promo Earned: {w.totalPromotionalEarned ?? 0}c · Gift Beans: {w.earnedBeans ?? 0}
                      </p>
                    </div>
                    <div className="text-right tabular-nums">
                      <p className="font-bold text-amber-600 dark:text-amber-400">{w.coinsBalance ?? 0} coins</p>
                      <p className="text-[11px] text-zinc-500">Spent: {w.totalSpent ?? 0}c</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 10. TRANSACTION HISTORY & COIN ORDERS */}
      {subTab === 'transactions' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-3">
            <h4 className="font-display text-sm font-bold">
              Coin Purchase Orders ({topupRequests.length})
            </h4>
            {topupRequests.length === 0 ? (
              <p className="text-xs text-zinc-500">No coin top-up orders submitted yet.</p>
            ) : (
              <div className="space-y-2">
                {topupRequests.map((req) => (
                  <div
                    key={req.id}
                    className="rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="font-bold">
                        @{req.username} · {req.packageName} ({req.coins} coins)
                      </p>
                      <p className="text-zinc-500">
                        {req.amountLabel} · {req.paymentProvider} · Ref: {req.paymentRef || 'None'} ·{' '}
                        {formatRelativeTime(req.createdAt)}
                      </p>
                    </div>
                    {req.status === 'pending' ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            await reviewCoinTopupRequestOwner(req, 'approved', 'Approved by Owner', currentUser);
                            onToast(`Credited ${req.coins} purchased coins to @${req.username}`);
                            await onRefreshParent();
                          }}
                          className="h-9 px-3.5 rounded-xl bg-[#0D6E6E] text-white font-semibold cursor-pointer"
                        >
                          Approve &amp; Credit
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await reviewCoinTopupRequestOwner(req, 'rejected', 'Declined by Owner', currentUser);
                            onToast(`Declined order from @${req.username}`);
                            await onRefreshParent();
                          }}
                          className="h-9 px-3 rounded-xl border border-red-300 text-red-600 font-semibold cursor-pointer"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span
                        className={`font-bold capitalize flex items-center gap-1 ${
                          req.status === 'approved' ? 'text-emerald-600' : 'text-red-600'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{req.status}</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-display text-sm font-bold">
                Global Coin Ledger ({filteredTransactions.length})
              </h4>
              <div className="flex items-center gap-1.5">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'purchased', label: 'Purchased' },
                    { id: 'promotional', label: 'Promotional' },
                    { id: 'gifts', label: 'Gifts' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setTxFilter(f.id)}
                    className={`h-8 px-3 rounded-lg text-xs font-semibold cursor-pointer ${
                      txFilter === f.id
                        ? 'bg-[#0D6E6E] text-white'
                        : 'border border-[#E4DFD5] dark:border-[#262C30] text-zinc-600 dark:text-zinc-300'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredTransactions.slice(0, 60).map((tx) => {
                const u = userByUid.get(tx.userId);
                return (
                  <div
                    key={tx.id}
                    className="rounded-xl border border-[#E4DFD5] dark:border-[#262C30] px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{tx.note}</p>
                      <p className="text-[11px] text-zinc-500 truncate">
                        {u ? `@${u.username}` : tx.userId} · {tx.type}
                        {tx.coinSource ? ` · ${tx.coinSource}` : ''} · {formatRelativeTime(tx.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`font-bold tabular-nums shrink-0 ${
                        tx.coinsDelta >= 0 ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {tx.coinsDelta >= 0 ? `+${tx.coinsDelta}` : tx.coinsDelta}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
