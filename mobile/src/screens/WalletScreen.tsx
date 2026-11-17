import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth, SERVER_API_BASE } from '../config/firebase';
import { PALETTE } from '../i18n/translations';
import {
  DEFAULT_COIN_PACKAGES,
  formatRelativeTime,
  submitCoinTopupRequest,
  subscribeCoinPackages,
  subscribeMyCoinTopupRequests,
  subscribeMyCoinTransactions,
  subscribeMyGiftHistory,
} from '../services/api';
import { claimPeriodicBonusUser, fetchEconomyStatusUser } from '../services/economyApi';
import {
  CoinPackage,
  CoinTopupRequest,
  CoinTransaction,
  EconomyUserStatus,
  GiftEvent,
  UserProfile,
  UserWallet,
} from '../types/social';

interface WalletScreenProps {
  currentUser: UserProfile;
  wallet: UserWallet | null;
  allowCoinPurchases: boolean;
  darkMode: boolean;
  onToast: (msg: string) => void;
}

export const WalletScreen: React.FC<WalletScreenProps> = ({
  currentUser,
  wallet,
  allowCoinPurchases,
  darkMode,
  onToast,
}) => {
  const c = darkMode ? PALETTE.dark : PALETTE.light;
  const [tab, setTab] = useState<'coins' | 'rewards' | 'history'>('coins');
  const [packages, setPackages] = useState<CoinPackage[]>(DEFAULT_COIN_PACKAGES);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [sentGifts, setSentGifts] = useState<GiftEvent[]>([]);
  const [recvGifts, setRecvGifts] = useState<GiftEvent[]>([]);
  const [topups, setTopups] = useState<CoinTopupRequest[]>([]);
  const [economyStatus, setEconomyStatus] = useState<EconomyUserStatus | null>(null);
  const [claimingType, setClaimingType] = useState<'daily' | 'weekly' | 'monthly' | null>(null);
  const [paymentRef, setPaymentRef] = useState('');

  const refreshEconomy = () => {
    void fetchEconomyStatusUser().then(setEconomyStatus).catch(() => {});
  };

  useEffect(() => {
    const u1 = subscribeCoinPackages(setPackages);
    const u2 = subscribeMyCoinTransactions(currentUser.uid, setTransactions);
    const u3 = subscribeMyGiftHistory(currentUser.uid, (s, r) => {
      setSentGifts(s);
      setRecvGifts(r);
    });
    const u4 = subscribeMyCoinTopupRequests(currentUser.uid, setTopups);
    refreshEconomy();
    return () => {
      u1();
      u2();
      u3();
      u4();
    };
  }, [currentUser.uid]);

  const handleClaim = async (bonusType: 'daily' | 'weekly' | 'monthly') => {
    setClaimingType(bonusType);
    try {
      const resp = await claimPeriodicBonusUser(bonusType);
      onToast(`Claimed +${resp.coinsAwarded} promotional coins!`);
      refreshEconomy();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to claim bonus');
    } finally {
      setClaimingType(null);
    }
  };

  const handleBuyPackage = async (pkg: CoinPackage) => {
    if (!allowCoinPurchases) {
      onToast('Coin purchases are paused by the platform owner.');
      return;
    }
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      onToast('Please sign in again to complete checkout.');
      return;
    }
    try {
      const idToken = await firebaseUser.getIdToken();
      const resp = await fetch(`${SERVER_API_BASE}/api/coins/create-checkout`, {
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

      const data = (await resp.json().catch(() => ({}))) as {
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
        throw new Error(data.error || 'Checkout verification failed');
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
        await Linking.openURL(data.checkoutUrl);
        return;
      }

      await submitCoinTopupRequest({
        user: currentUser,
        pkg: authoritativePkg,
        paymentProvider: data.provider === 'razorpay' ? 'razorpay' : 'owner_approval',
        paymentRef: paymentRef.trim() || data.orderId || `android_order_${Date.now().toString(36)}`,
      });
      setPaymentRef('');
      onToast(
        `Coin order submitted: ${authoritativeCoins.toLocaleString('en-IN')} Coins (₹${authoritativeInr.toLocaleString('en-IN')}). Pending Owner approval.`
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to submit coin order');
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 14, gap: 12 }}>
      {/* Balance Summary (Separates Purchased vs Promotional Coins) */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 10 }]}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: c.bg }}>
            <Text style={{ color: c.muted, fontSize: 10, fontWeight: '700' }}>COIN BALANCE</Text>
            <Text style={{ color: c.marigold, fontSize: 22, fontWeight: '900', marginTop: 4 }}>
              {wallet?.coinsBalance ?? 0}
            </Text>
          </View>
          <View style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: c.bg }}>
            <Text style={{ color: c.muted, fontSize: 10, fontWeight: '700' }}>HOST REWARD BEANS</Text>
            <Text style={{ color: c.teal, fontSize: 22, fontWeight: '900', marginTop: 4 }}>
              {wallet?.earnedBeans ?? 0}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, padding: 10, borderRadius: 12, backgroundColor: c.bg }}>
            <Text style={{ color: c.muted, fontSize: 10, fontWeight: '700' }}>PURCHASED COINS</Text>
            <Text style={{ color: c.teal, fontSize: 15, fontWeight: '800', marginTop: 2 }}>
              {wallet?.totalPurchased ?? 0}
            </Text>
          </View>
          <View style={{ flex: 1, padding: 10, borderRadius: 12, backgroundColor: c.bg }}>
            <Text style={{ color: c.muted, fontSize: 10, fontWeight: '700' }}>PROMOTIONAL EARNED</Text>
            <Text style={{ color: c.marigold, fontSize: 15, fontWeight: '800', marginTop: 2 }}>
              {wallet?.totalPromotionalEarned ?? 0}
            </Text>
          </View>
        </View>
      </View>

      {/* Tabs */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['coins', 'rewards', 'history'] as const).map((tb) => (
          <TouchableOpacity
            key={tb}
            style={[
              styles.tabBtn,
              { backgroundColor: tab === tb ? c.teal : c.surface, borderColor: c.border },
            ]}
            onPress={() => setTab(tb)}
          >
            <Text style={{ color: tab === tb ? '#FFF' : c.text, fontSize: 12, fontWeight: '700' }}>
              {tb === 'coins' ? 'Buy Coins' : tb === 'rewards' ? 'Bonuses' : 'History'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'coins' && (
        <View style={{ gap: 10 }}>
          <TextInput
            placeholder="Optional Payment / UPI Reference Note"
            placeholderTextColor={c.muted}
            value={paymentRef}
            onChangeText={setPaymentRef}
            style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.surface }]}
          />
          {packages
            .filter((p) => p.active)
            .map((pkg) => (
              <View
                key={pkg.id}
                style={[
                  styles.card,
                  {
                    backgroundColor: c.surface,
                    borderColor: c.border,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  },
                ]}
              >
                <View>
                  <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>
                    {pkg.coins.toLocaleString('en-IN')} Coins
                  </Text>
                  <Text style={{ color: c.teal, fontSize: 12, fontWeight: '700' }}>
                    {pkg.name} · ₹{pkg.priceInr.toLocaleString('en-IN')} INR
                  </Text>
                  {pkg.bonusCoins > 0 && (
                    <Text style={{ color: c.marigold, fontSize: 11, fontWeight: '700' }}>
                      +{pkg.bonusCoins.toLocaleString('en-IN')} bonus coins
                    </Text>
                  )}
                </View>
                <TouchableOpacity
                  style={{ height: 38, paddingHorizontal: 14, borderRadius: 12, backgroundColor: c.marigold, justifyContent: 'center' }}
                  onPress={() => handleBuyPackage(pkg)}
                >
                  <Text style={{ color: '#14171A', fontWeight: '800', fontSize: 12 }}>
                    ₹{pkg.priceInr.toLocaleString('en-IN')}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}

          {topups.length > 0 && (
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 6 }]}>
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 13 }}>Recent Coin Orders</Text>
              {topups.slice(0, 6).map((tp) => (
                <Text key={tp.id} style={{ color: c.muted, fontSize: 12 }}>
                  {tp.packageName} (+{tp.coins}) — {tp.status.toUpperCase()}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      {tab === 'rewards' && (
        <View style={{ gap: 10 }}>
          {(
            [
              { key: 'daily' as const, title: 'Daily Check-In Bonus', data: economyStatus?.claims.daily },
              { key: 'weekly' as const, title: 'Weekly Bonus', data: economyStatus?.claims.weekly },
              { key: 'monthly' as const, title: 'Monthly Bonus', data: economyStatus?.claims.monthly },
            ]
          ).map(({ key, title, data }) => (
            <View
              key={key}
              style={[
                styles.card,
                { backgroundColor: c.surface, borderColor: c.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 13 }}>
                  {title} (+{data?.amount ?? (key === 'weekly' ? 60 : key === 'monthly' ? 200 : 10)}c)
                </Text>
                <Text style={{ color: c.muted, fontSize: 11 }}>{data?.reason || 'Loading...'}</Text>
              </View>
              <TouchableOpacity
                disabled={!data?.eligible || claimingType === key}
                onPress={() => void handleClaim(key)}
                style={{
                  height: 34,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  backgroundColor: data?.eligible ? c.teal : c.bg,
                  borderWidth: 1,
                  borderColor: data?.eligible ? c.teal : c.border,
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: data?.eligible ? '#FFF' : c.muted, fontSize: 11, fontWeight: '800' }}>
                  {claimingType === key ? '...' : data?.claimed ? 'Claimed' : 'Claim'}
                </Text>
              </TouchableOpacity>
            </View>
          ))}

          {economyStatus && (
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 4 }]}>
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 13 }}>
                Speaking &amp; Hosting Rewards Progress
              </Text>
              <Text style={{ color: c.muted, fontSize: 11 }}>
                Speaking today: {economyStatus.progress.speakingDailyCoinsEarned}/{economyStatus.config.speakingDailyMaxCoins}c (+{economyStatus.config.speakingRewardCoins}c / {economyStatus.config.speakingMinutesPerReward}m)
              </Text>
              <Text style={{ color: c.muted, fontSize: 11 }}>
                Hosting today: {economyStatus.progress.hostingDailyCoinsEarned}/{economyStatus.config.hostingDailyMaxCoins}c · Month: {economyStatus.progress.hostingMonthlyCoinsEarned}/{economyStatus.config.hostingMonthlyMaxCoins}c
              </Text>
            </View>
          )}

          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>Host Gift Beans</Text>
            <Text style={{ color: c.muted, fontSize: 12 }}>
              Earned Beans: {wallet?.earnedBeans ?? 0} · Total Spent: {wallet?.totalSpent ?? 0}
            </Text>
            {recvGifts.length === 0 ? (
              <Text style={{ color: c.muted, fontSize: 12 }}>
                No gifts received yet. Host an Audio Party to earn beans!
              </Text>
            ) : (
              recvGifts.map((g) => (
                <Text key={g.id} style={{ color: c.text, fontSize: 12 }}>
                  {g.giftEmoji} {g.giftName} from {g.senderName} (+{g.coinsCost} beans) · {formatRelativeTime(g.createdAt)} · Tx: {g.transactionId || g.id}
                </Text>
              ))
            )}
          </View>
        </View>
      )}

      {tab === 'history' && (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
          <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>Coin &amp; Gift History</Text>
          {transactions.map((tx) => (
            <View key={tx.id} style={{ paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: c.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: c.text, fontSize: 12, flex: 1 }}>{tx.note}</Text>
                <Text style={{ color: tx.coinsDelta >= 0 ? c.teal : c.danger, fontSize: 12, fontWeight: '800' }}>
                  {tx.coinsDelta >= 0 ? `+${tx.coinsDelta}` : tx.coinsDelta}
                </Text>
              </View>
              <Text style={{ color: c.muted, fontSize: 10 }}>
                {tx.coinSource || tx.type} · {formatRelativeTime(tx.createdAt)}
              </Text>
            </View>
          ))}
          {sentGifts.length > 0 && (
            <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.border, gap: 6 }}>
              <Text style={{ color: c.muted, fontSize: 12, fontWeight: '800' }}>
                Gifts Sent ({sentGifts.length})
              </Text>
              {sentGifts.map((g) => (
                <View key={g.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }}>
                      {g.giftEmoji} {g.giftName} to {g.recipientName}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 10 }}>
                      {g.roomTitle} · {formatRelativeTime(g.createdAt)} · Tx: {g.transactionId || g.id}
                    </Text>
                  </View>
                  <Text style={{ color: c.danger, fontSize: 12, fontWeight: '800' }}>-{g.coinsCost} 🪙</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 14 },
  tabBtn: { flex: 1, height: 38, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  input: { height: 46, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, fontSize: 14 },
});

