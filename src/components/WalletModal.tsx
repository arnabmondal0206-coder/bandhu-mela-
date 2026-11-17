import React, { useEffect, useState } from 'react';
import {
  Award,
  CheckCircle2,
  Coins,
  CreditCard,
  Gift,
  History,
  Loader2,
  Mic,
  Radio,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  DEFAULT_COIN_PACKAGES,
  submitCoinTopupRequest,
  subscribeCoinPackages,
  subscribeMyCoinTopupRequests,
  subscribeMyCoinTransactions,
  subscribeMyGiftHistory,
} from '../lib/audioPartyApi';
import { claimPeriodicBonusUser, fetchEconomyStatusUser } from '../lib/economyApi';
import { auth } from '../lib/firebase';
import { formatRelativeTime } from '../lib/socialApi';
import {
  CoinPackage,
  CoinTopupRequest,
  CoinTransaction,
  EconomyUserStatus,
  GiftEvent,
  UserProfile,
  UserWallet,
} from '../types/social';

interface WalletModalProps {
  currentUser: UserProfile;
  wallet: UserWallet | null;
  allowCoinPurchases?: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
}

export const WalletModal: React.FC<WalletModalProps> = ({
  currentUser,
  wallet,
  allowCoinPurchases = true,
  onClose,
  onToast,
}) => {
  const [tab, setTab] = useState<'coins' | 'rewards' | 'history'>('coins');
  const [packages, setPackages] = useState<CoinPackage[]>(DEFAULT_COIN_PACKAGES);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [sentGifts, setSentGifts] = useState<GiftEvent[]>([]);
  const [receivedGifts, setReceivedGifts] = useState<GiftEvent[]>([]);
  const [topups, setTopups] = useState<CoinTopupRequest[]>([]);
  const [economyStatus, setEconomyStatus] = useState<EconomyUserStatus | null>(null);
  const [claimingType, setClaimingType] = useState<'daily' | 'weekly' | 'monthly' | null>(null);
  const [gatewayConfig, setGatewayConfig] = useState<{
    stripeEnabled: boolean;
    razorpayEnabled: boolean;
    ownerApprovalEnabled: boolean;
  }>({ stripeEnabled: false, razorpayEnabled: false, ownerApprovalEnabled: true });
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [paymentRefInput, setPaymentRefInput] = useState('');

  const refreshEconomyStatus = () => {
    void fetchEconomyStatusUser()
      .then((status) => {
        setEconomyStatus(status);
        setGatewayConfig(status.gateway);
      })
      .catch(() => {});
  };

  useEffect(() => {
    const u1 = subscribeCoinPackages(setPackages);
    const u2 = subscribeMyCoinTransactions(currentUser.uid, setTransactions);
    const u3 = subscribeMyGiftHistory(currentUser.uid, (sent, recv) => {
      setSentGifts(sent);
      setReceivedGifts(recv);
    });
    const u4 = subscribeMyCoinTopupRequests(currentUser.uid, setTopups);
    void fetch('/api/coins/config')
      .then((r) => r.json())
      .then((cfg) => setGatewayConfig(cfg))
      .catch(() => {});
    refreshEconomyStatus();

    return () => {
      u1();
      u2();
      u3();
      u4();
    };
  }, [currentUser.uid]);

  const handleClaimBonus = async (bonusType: 'daily' | 'weekly' | 'monthly') => {
    setClaimingType(bonusType);
    try {
      const resp = await claimPeriodicBonusUser(bonusType);
      onToast(`Claimed +${resp.coinsAwarded} promotional coins!`);
      refreshEconomyStatus();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to claim bonus');
    } finally {
      setClaimingType(null);
    }
  };

  const handlePurchasePackage = async (pkg: CoinPackage) => {
    if (!allowCoinPurchases) {
      onToast('Coin purchases are currently paused by the platform owner.');
      return;
    }
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      onToast('Please sign in again to complete checkout.');
      return;
    }
    setBuyingId(pkg.id);
    try {
      const idToken = await firebaseUser.getIdToken();
      const resp = await fetch('/api/coins/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          packageId: pkg.id,
          coins: pkg.coins + (pkg.bonusCoins || 0),
          priceInr: pkg.priceInr,
        }),
      });
      const data = (await resp.json()) as {
        provider?: 'stripe' | 'razorpay' | 'owner_approval';
        checkoutUrl?: string;
        orderId?: string;
        packageId?: string;
        packageName?: string;
        coins?: number;
        priceInr?: number;
        error?: string;
      };

      if (!resp.ok) {
        throw new Error(data.error || 'Checkout failed');
      }

      const authoritativeCoins =
        typeof data.coins === 'number' && data.coins > 0 ? data.coins : pkg.coins + (pkg.bonusCoins || 0);
      const authoritativeInr =
        typeof data.priceInr === 'number' && data.priceInr > 0 ? data.priceInr : pkg.priceInr;
      const authoritativePkg: CoinPackage = {
        ...pkg,
        id: data.packageId || pkg.id,
        name: data.packageName || pkg.name,
        coins: authoritativeCoins,
        bonusCoins: 0,
        priceInr: authoritativeInr,
      };

      if (data.provider === 'stripe' && data.checkoutUrl) {
        await submitCoinTopupRequest({
          user: currentUser,
          pkg: authoritativePkg,
          paymentProvider: 'stripe',
          paymentRef: `stripe_checkout:${authoritativePkg.id}`,
        });
        window.location.assign(data.checkoutUrl);
        return;
      }

      await submitCoinTopupRequest({
        user: currentUser,
        pkg: authoritativePkg,
        paymentProvider: data.provider === 'razorpay' ? 'razorpay' : 'owner_approval',
        paymentRef: paymentRefInput.trim() || data.orderId || `order_${Date.now()}`,
      });
      setPaymentRefInput('');
      onToast(
        `Coin order submitted for ${authoritativeCoins.toLocaleString('en-IN')} Coins (₹${authoritativeInr.toLocaleString('en-IN')}). Pending Owner verification.`
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to start purchase');
    } finally {
      setBuyingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[88vh] bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden shadow-2xl flex flex-col">
        <div className="px-6 py-4 border-b border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-zinc-950 flex items-center justify-center">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold">BANDHU MELA Wallet &amp; Rewards</h2>
              <p className="text-xs text-zinc-500">Purchased coins, promotional rewards &amp; host beans</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary Balance Strip (Separates Purchased vs Promotional Coins) */}
        <div className="px-6 py-4 bg-[#F7F5F0] dark:bg-[#0E1113] border-b border-[#E4DFD5] dark:border-[#262C30] grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-2xl p-3">
            <p className="text-[11px] font-semibold text-zinc-500">Coins Balance</p>
            <p className="font-display text-xl font-bold text-amber-600 dark:text-amber-400 tabular-nums mt-0.5">
              {wallet?.coinsBalance ?? 0}
            </p>
          </div>
          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-2xl p-3">
            <p className="text-[11px] font-semibold text-zinc-500">Purchased Coins</p>
            <p className="font-display text-xl font-bold text-[#0D6E6E] dark:text-teal-400 tabular-nums mt-0.5">
              {wallet?.totalPurchased ?? 0}
            </p>
          </div>
          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-2xl p-3">
            <p className="text-[11px] font-semibold text-zinc-500">Promotional Earned</p>
            <p className="font-display text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
              {wallet?.totalPromotionalEarned ?? 0}
            </p>
          </div>
          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-2xl p-3">
            <p className="text-[11px] font-semibold text-zinc-500">Host Gift Beans</p>
            <p className="font-display text-xl font-bold tabular-nums mt-0.5">
              {wallet?.earnedBeans ?? 0}
            </p>
          </div>
        </div>

        {/* Modal Tabs */}
        <div className="px-6 pt-3 flex items-center gap-2 border-b border-[#E4DFD5] dark:border-[#262C30]">
          {[
            { id: 'coins' as const, label: 'Buy Coins', icon: CreditCard },
            { id: 'rewards' as const, label: 'Bonuses & Rewards', icon: Award },
            { id: 'history' as const, label: 'History & Ledger', icon: History },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`h-10 px-4 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
                  active
                    ? 'border-[#0D6E6E] text-[#0D6E6E] dark:text-teal-400'
                    : 'border-transparent text-zinc-500'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {tab === 'coins' && (
            <>
              <div className="rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0]/70 dark:bg-[#0E1113]/70 p-4 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-[#0D6E6E] dark:text-teal-400 shrink-0 mt-0.5" />
                <div className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1">
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {gatewayConfig.stripeEnabled
                      ? 'Stripe Live Checkout'
                      : gatewayConfig.razorpayEnabled
                      ? 'Razorpay Live Checkout'
                      : 'Owner Verification Order Mode (No Live Card Gateway Configured)'}
                  </p>
                  <p>
                    {gatewayConfig.stripeEnabled || gatewayConfig.razorpayEnabled
                      ? 'Checkout sessions and HMAC signatures are verified server-side before crediting Purchased Coins.'
                      : 'Live payment gateways are off until configured by the Platform Owner. Ordering a package submits a pending request for Owner verification.'}
                  </p>
                </div>
              </div>

              <input
                type="text"
                maxLength={120}
                value={paymentRefInput}
                onChange={(e) => setPaymentRefInput(e.target.value)}
                placeholder="Optional UPI / Transaction reference note for Owner verification"
                className="w-full h-10 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs"
              />

              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                  Official Coin Store Packages (INR ₹)
                </h4>
                <span className="text-[11px] font-semibold text-zinc-500">
                  {packages.filter((p) => p.active).length} packages available
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {packages
                  .filter((p) => p.active)
                  .map((pkg) => (
                    <div
                      key={pkg.id}
                      className="rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] p-4 flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-xs font-bold text-[#0D6E6E] dark:text-teal-400">{pkg.name}</p>
                        <p className="font-display text-lg font-bold tabular-nums mt-0.5">
                          {pkg.coins.toLocaleString('en-IN')} Coins
                        </p>
                        <p className="text-[11px] text-zinc-500 tabular-nums">
                          Price: ₹{pkg.priceInr.toLocaleString('en-IN')} INR
                        </p>
                        {pkg.bonusCoins > 0 && (
                          <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                            <Sparkles className="w-3 h-3" />
                            <span>+{pkg.bonusCoins.toLocaleString('en-IN')} bonus coins</span>
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={buyingId === pkg.id || !allowCoinPurchases}
                        onClick={() => handlePurchasePackage(pkg)}
                        className="h-10 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold shrink-0 cursor-pointer disabled:opacity-50 tabular-nums"
                      >
                        {buyingId === pkg.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          `₹${pkg.priceInr.toLocaleString('en-IN')}`
                        )}
                      </button>
                    </div>
                  ))}
              </div>

              {topups.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-zinc-500">Your Coin Orders</h4>
                  <div className="space-y-2">
                    {topups.slice(0, 6).map((req) => (
                      <div
                        key={req.id}
                        className="rounded-xl border border-[#E4DFD5] dark:border-[#262C30] px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <div>
                          <p className="font-semibold">
                            {req.packageName} · <span className="tabular-nums">{req.coins}</span> coins
                          </p>
                          <p className="text-[11px] text-zinc-500">
                            {req.amountLabel} · {formatRelativeTime(req.createdAt)}
                          </p>
                        </div>
                        <span
                          className={`font-bold capitalize ${
                            req.status === 'approved'
                              ? 'text-emerald-600'
                              : req.status === 'rejected'
                              ? 'text-red-600'
                              : 'text-amber-600'
                          }`}
                        >
                          {req.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'rewards' && (
            <div className="space-y-4">
              {/* Periodic Promotional Bonuses */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(
                  [
                    { key: 'daily' as const, title: 'Daily Check-In', data: economyStatus?.claims.daily },
                    { key: 'weekly' as const, title: 'Weekly Bonus', data: economyStatus?.claims.weekly },
                    { key: 'monthly' as const, title: 'Monthly Bonus', data: economyStatus?.claims.monthly },
                  ]
                ).map(({ key, title, data }) => (
                  <div
                    key={key}
                    className="rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] p-4 flex flex-col justify-between gap-3"
                  >
                    <div>
                      <p className="text-xs font-bold">{title}</p>
                      <p className="font-display text-xl font-bold text-amber-600 dark:text-amber-400 tabular-nums mt-0.5">
                        +{data?.amount ?? (key === 'weekly' ? 60 : key === 'monthly' ? 200 : 10)}c
                      </p>
                      <p className="text-[11px] text-zinc-500 mt-1">
                        {data?.reason || 'Checking eligibility...'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={!data?.eligible || claimingType === key}
                      onClick={() => void handleClaimBonus(key)}
                      className={`h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                        data?.claimed
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-[#0D6E6E] text-white'
                      }`}
                    >
                      {claimingType === key ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : data?.claimed ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Claimed</span>
                        </>
                      ) : (
                        <span>Claim Bonus</span>
                      )}
                    </button>
                  </div>
                ))}
              </div>

              {/* Active Speaking & Hosting Progress */}
              {economyStatus && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] p-4 space-y-1.5 text-xs">
                    <p className="font-bold flex items-center gap-1.5">
                      <Mic className="w-3.5 h-3.5 text-[#0D6E6E]" />
                      <span>Active Speaking Rewards</span>
                    </p>
                    <p className="text-zinc-500">
                      {economyStatus.config.speakingRewardEnabled
                        ? `+${economyStatus.config.speakingRewardCoins}c every ${economyStatus.config.speakingMinutesPerReward} active unmuted mins (Today: ${economyStatus.progress.speakingDailyCoinsEarned}/${economyStatus.config.speakingDailyMaxCoins}c)`
                        : 'Speaking rewards are paused by Owner.'}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      Current progress: {Math.floor((economyStatus.progress.speakingCarrySeconds || 0) / 60)}m{' '}
                      {(economyStatus.progress.speakingCarrySeconds || 0) % 60}s toward next payout
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] p-4 space-y-1.5 text-xs">
                    <p className="font-bold flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-amber-500" />
                      <span>Live Hosting Bonus</span>
                    </p>
                    <p className="text-zinc-500">
                      {economyStatus.config.hostingBonusEnabled
                        ? `+${economyStatus.config.hostingCoinsPerUnit}c ${economyStatus.config.hostingRateMode === 'per_hour' ? '/hr' : '/min'} with >=${economyStatus.config.hostingMinListeners} users (Today: ${economyStatus.progress.hostingDailyCoinsEarned}/${economyStatus.config.hostingDailyMaxCoins}c)`
                        : 'Hosting bonus is paused by Owner.'}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      Monthly host earned: {economyStatus.progress.hostingMonthlyCoinsEarned}/{economyStatus.config.hostingMonthlyMaxCoins}c
                    </p>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] p-5 bg-gradient-to-br from-[#0D6E6E]/10 to-amber-500/10 space-y-2">
                <p className="text-xs font-bold text-[#0D6E6E] dark:text-teal-400">
                  Host &amp; Speaker Gift Beans
                </p>
                <p className="font-display text-3xl font-bold tabular-nums">
                  {wallet?.earnedBeans ?? 0} <span className="text-sm font-medium text-zinc-500">Reward Beans</span>
                </p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Every virtual gift you receive while hosting or speaking on an Audio Party stage credits your Host Reward balance 1:1.
                </p>
              </div>

              <h4 className="text-xs font-bold text-zinc-500">Gifts Received ({receivedGifts.length})</h4>
              {receivedGifts.length === 0 ? (
                <p className="text-xs text-zinc-500 py-4 text-center">
                  Host or speak in an Audio Party room to receive gifts from listeners!
                </p>
              ) : (
                <div className="space-y-2">
                  {receivedGifts.map((ev) => (
                    <div
                      key={ev.id}
                      className="rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] px-4 py-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-2xl shrink-0">{ev.giftEmoji}</span>
                        <div className="min-w-0">
                          <p className="font-semibold truncate">
                            {ev.senderName} sent {ev.giftName}
                          </p>
                          <p className="text-[11px] text-zinc-500 truncate">
                            {ev.roomTitle} · {formatRelativeTime(ev.createdAt)} · Tx: {ev.transactionId || ev.id}
                          </p>
                        </div>
                      </div>
                      <span className="font-bold text-[#0D6E6E] dark:text-teal-400 tabular-nums shrink-0">
                        +{ev.coinsCost} beans
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'history' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-zinc-500">Coin Ledger ({transactions.length})</h4>
                {transactions.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-4 text-center">No coin transactions yet.</p>
                ) : (
                  transactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] px-4 py-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <p className="font-semibold">{tx.note}</p>
                        <p className="text-[11px] text-zinc-500">
                          {tx.counterpartyName} · {tx.coinSource || tx.type} · {formatRelativeTime(tx.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`font-bold tabular-nums ${
                          tx.coinsDelta >= 0 ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {tx.coinsDelta >= 0 ? `+${tx.coinsDelta}` : tx.coinsDelta}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2 pt-2 border-t border-[#E4DFD5] dark:border-[#262C30]">
                <h4 className="text-xs font-bold text-zinc-500 flex items-center gap-1.5">
                  <Gift className="w-3.5 h-3.5 text-amber-500" />
                  <span>Gifts Sent ({sentGifts.length})</span>
                </h4>
                {sentGifts.map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] px-4 py-3 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-xl shrink-0">{ev.giftEmoji}</span>
                      <div className="min-w-0">
                        <p className="font-semibold truncate">
                          {ev.giftName} to {ev.recipientName}
                        </p>
                        <p className="text-[11px] text-zinc-500 truncate">
                          {ev.roomTitle} · {formatRelativeTime(ev.createdAt)} · Tx: {ev.transactionId || ev.id}
                        </p>
                      </div>
                    </div>
                    <span className="text-rose-600 font-semibold tabular-nums shrink-0">-{ev.coinsCost} coins</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

