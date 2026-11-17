import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { PALETTE } from '../i18n/translations';
import {
  adjustUserWalletOwner,
  DEFAULT_COIN_PACKAGES,
  DEFAULT_VIRTUAL_GIFTS,
  deleteCoinPackage,
  deleteVirtualGift,
  formatRelativeTime,
  LEGACY_COIN_PACKAGE_IDS,
  makeId,
  reviewCoinTopupRequestOwner,
  saveCoinPackage,
  saveVirtualGift,
} from '../services/api';
import {
  fetchOwnerEconomyOverview,
  saveOwnerEconomyConfig,
  syncApprovedCoinPackagesOwner,
  updateOwnerPromoPool,
} from '../services/economyApi';
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

type SubTab =
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
  packages: CoinPackage[];
  wallets: UserWallet[];
  transactions: CoinTransaction[];
  topups: CoinTopupRequest[];
  darkMode: boolean;
  onRefreshParent: () => Promise<void> | void;
  onAudit: (action: string, targetType: string, targetId: string, details: string) => Promise<void>;
  onToast: (msg: string) => void;
}

const DEFAULT_CFG: CoinEconomyConfig = {
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

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'pricing', label: 'Coin Pricing' },
  { id: 'daily', label: 'Daily Bonus' },
  { id: 'weekly', label: 'Weekly Bonus' },
  { id: 'monthly', label: 'Monthly Bonus' },
  { id: 'speaking', label: 'Speaking Rewards' },
  { id: 'hosting', label: 'Hosting Bonus' },
  { id: 'promotional', label: 'Promotional Pool' },
  { id: 'gifts', label: 'Gift Pricing' },
  { id: 'wallets', label: 'User Wallets' },
  { id: 'transactions', label: 'Transaction History' },
];

export const OwnerCoinEconomyPanel: React.FC<OwnerCoinEconomyPanelProps> = ({
  currentUser,
  users,
  gifts,
  packages,
  wallets,
  transactions,
  topups,
  darkMode,
  onRefreshParent,
  onAudit,
  onToast,
}) => {
  const c = darkMode ? PALETTE.dark : PALETTE.light;
  const [subTab, setSubTab] = useState<SubTab>('pricing');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [configDraft, setConfigDraft] = useState<CoinEconomyConfig>(DEFAULT_CFG);
  const [pool, setPool] = useState<PromotionalPool | null>(null);
  const [ledger, setLedger] = useState<PromotionalLedgerEntry[]>([]);
  const [gateway, setGateway] = useState({ stripeEnabled: false, razorpayEnabled: false });

  // Forms
  const [pkgName, setPkgName] = useState('');
  const [pkgCoins, setPkgCoins] = useState('100');
  const [pkgBonus, setPkgBonus] = useState('0');
  const [pkgInr, setPkgInr] = useState('10');
  const [pkgUsd, setPkgUsd] = useState('0.12');
  const [editingPkgPrices, setEditingPkgPrices] = useState<Record<string, string>>({});

  const [issueAmount, setIssueAmount] = useState('5000');
  const [issueNote, setIssueNote] = useState('Owner Promotional Reserve Allocation');
  const [dailyCapDraft, setDailyCapDraft] = useState('500');
  const [monthlyCapDraft, setMonthlyCapDraft] = useState('5000');
  const [maxSingleDraft, setMaxSingleDraft] = useState('1000');
  const [promoGrantUid, setPromoGrantUid] = useState('');
  const [promoGrantAmt, setPromoGrantAmt] = useState('50');
  const [promoGrantNote, setPromoGrantNote] = useState('Owner Promotional Bonus');

  const [giftName, setGiftName] = useState('');
  const [giftEmoji, setGiftEmoji] = useState('🎁');
  const [giftPrice, setGiftPrice] = useState('50');
  const [giftAnim, setGiftAnim] = useState<VirtualGift['animationType']>('sparkle');
  const [editingGiftPrices, setEditingGiftPrices] = useState<Record<string, string>>({});

  const [walletTargetUid, setWalletTargetUid] = useState('');
  const [walletDelta, setWalletDelta] = useState('100');
  const [txFilter, setTxFilter] = useState<'all' | 'purchased' | 'promotional' | 'gifts'>('all');

  const userByUid = useMemo(() => {
    const map = new Map<string, UserProfile>();
    users.forEach((u) => map.set(u.uid, u));
    return map;
  }, [users]);

  const loadOverview = async () => {
    setLoading(true);
    try {
      const ov = await fetchOwnerEconomyOverview();
      setConfigDraft(ov.config);
      setPool(ov.pool);
      setLedger(ov.promotionalLedger);
      setGateway(ov.gateway);
      setDailyCapDraft(String(ov.pool.perUserDailyCap));
      setMonthlyCapDraft(String(ov.pool.perUserMonthlyCap));
      setMaxSingleDraft(String(ov.pool.maxSingleReward));
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to load coin economy');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveConfig = async (label: string) => {
    setBusy(true);
    try {
      const resp = await saveOwnerEconomyConfig(configDraft);
      setConfigDraft(resp.config);
      onToast(`${label} saved and active.`);
      void loadOverview();
    } catch (err) {
      onToast(err instanceof Error ? err.message : `Failed to save ${label}`);
    } finally {
      setBusy(false);
    }
  };

  const filteredTx = useMemo(() => {
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

  return (
    <View style={{ gap: 12 }}>
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 6 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: c.text, fontWeight: '900', fontSize: 15 }}>Owner Coin Economy Control</Text>
          <TouchableOpacity
            style={[styles.smallBtn, { borderWidth: 1, borderColor: c.border }]}
            onPress={() => void loadOverview()}
          >
            {loading ? (
              <ActivityIndicator size="small" color={c.teal} />
            ) : (
              <Text style={{ color: c.teal, fontSize: 11, fontWeight: '800' }}>Sync</Text>
            )}
          </TouchableOpacity>
        </View>
        <Text style={{ color: c.muted, fontSize: 11 }}>
          Backend-validated rewards, separate Promotional Ledger, and Owner-locked pricing.
        </Text>
      </View>

      {/* 10 Sub-Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {SUB_TABS.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={[
              styles.subPill,
              { backgroundColor: subTab === t.id ? c.teal : c.surface, borderColor: c.border },
            ]}
            onPress={() => setSubTab(t.id)}
          >
            <Text style={{ color: subTab === t.id ? '#FFF' : c.text, fontSize: 11, fontWeight: '700' }}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 1. COIN PRICING */}
      {subTab === 'pricing' && (
        <View style={{ gap: 10 }}>
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 4 }]}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 13 }}>
              Gateway Status:{' '}
              {gateway.stripeEnabled
                ? 'Stripe Live'
                : gateway.razorpayEnabled
                ? 'Razorpay Live'
                : 'No Live Gateway Configured (Owner Approval Mode)'}
            </Text>
            <Text style={{ color: c.muted, fontSize: 11 }}>
              Real payments stay off unless Stripe/Razorpay server keys are configured. Orders only credit after verified Owner approval.
            </Text>
          </View>

          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 14, flex: 1 }}>
                Coin Store Packages (INR ₹)
              </Text>
              <TouchableOpacity
                disabled={busy}
                onPress={async () => {
                  setBusy(true);
                  try {
                    await syncApprovedCoinPackagesOwner();
                    await onRefreshParent();
                    onToast('Synced 5 official ₹ packages & removed legacy packages!');
                  } catch {
                    for (const legacyId of LEGACY_COIN_PACKAGE_IDS) {
                      await deleteCoinPackage(legacyId).catch(() => {});
                    }
                    for (const p of DEFAULT_COIN_PACKAGES) await saveCoinPackage(p);
                    onToast('5 official INR packages synced!');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Text style={{ color: c.teal, fontSize: 11, fontWeight: '800' }}>Sync 5 Official ₹</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              placeholder="Package Name"
              placeholderTextColor={c.muted}
              value={pkgName}
              onChangeText={setPkgName}
              style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TextInput
                placeholder="Coins"
                keyboardType="numeric"
                value={pkgCoins}
                onChangeText={setPkgCoins}
                style={[styles.input, { flex: 1, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
              <TextInput
                placeholder="Bonus (0)"
                keyboardType="numeric"
                value={pkgBonus}
                onChangeText={setPkgBonus}
                style={[styles.input, { flex: 1, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
              <TextInput
                placeholder="INR ₹"
                keyboardType="numeric"
                value={pkgInr}
                onChangeText={setPkgInr}
                style={[styles.input, { flex: 1, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
            </View>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: c.marigold }]}
              onPress={async () => {
                if (!pkgName.trim()) return;
                const pkgId = makeId('pkg');
                const coins = Math.max(1, Math.round(Number(pkgCoins) || 100));
                const bonusCoins = Math.max(0, Math.round(Number(pkgBonus) || 0));
                const priceInr = Math.max(1, Math.round(Number(pkgInr) || 10));
                const priceUsd = Number((priceInr / 83.5).toFixed(2)) || Number(pkgUsd) || 0.12;
                await saveCoinPackage({
                  id: pkgId,
                  name: pkgName.trim(),
                  coins,
                  bonusCoins,
                  priceInr,
                  priceUsd,
                  active: true,
                });
                await onAudit('create_coin_package', 'coinPackage', pkgId, `${pkgName.trim()} (${coins}c = ₹${priceInr})`);
                setPkgName('');
                onToast('Package added!');
              }}
            >
              <Text style={{ color: '#14171A', fontWeight: '800' }}>Add Coin Package</Text>
            </TouchableOpacity>
            {packages.map((p) => {
              const draftInr = editingPkgPrices[p.id] ?? String(p.priceInr);
              return (
                <View
                  key={p.id}
                  style={{
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: 12,
                    padding: 10,
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontSize: 12, fontWeight: '800' }}>
                        {p.name} ({p.coins.toLocaleString('en-IN')} Coins)
                      </Text>
                      <Text style={{ color: c.muted, fontSize: 11 }}>
                        ₹{p.priceInr.toLocaleString('en-IN')} INR
                        {p.bonusCoins > 0 ? ` · +${p.bonusCoins} bonus` : ''}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        onPress={async () => {
                          await saveCoinPackage({ ...p, active: !p.active });
                          await onAudit('toggle_coin_package', 'coinPackage', p.id, `${p.name} active=${!p.active}`);
                        }}
                      >
                        <Text style={{ color: p.active ? c.teal : c.muted, fontSize: 12, fontWeight: '700' }}>
                          {p.active ? 'Active' : 'Paused'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={async () => {
                          await deleteCoinPackage(p.id);
                          await onAudit('delete_coin_package', 'coinPackage', p.id, p.name);
                        }}
                      >
                        <Text style={{ color: c.danger, fontSize: 12, fontWeight: '700' }}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                    <Text style={{ color: c.muted, fontWeight: '800' }}>₹</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={draftInr}
                      onChangeText={(txt) => setEditingPkgPrices((prev) => ({ ...prev, [p.id]: txt }))}
                      style={[styles.input, { flex: 1, height: 36, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
                    />
                    <TouchableOpacity
                      style={[styles.smallBtn, { height: 36, backgroundColor: c.teal }]}
                      onPress={async () => {
                        const nextInr = Math.round(Number(draftInr));
                        if (!Number.isFinite(nextInr) || nextInr < 1) {
                          onToast('Enter valid INR price (min ₹1).');
                          return;
                        }
                        await saveCoinPackage({
                          ...p,
                          priceInr: nextInr,
                          priceUsd: Number((nextInr / 83.5).toFixed(2)),
                        });
                        await onAudit('update_coin_package_price', 'coinPackage', p.id, `${p.name}: ₹${nextInr}`);
                        onToast(`Updated ${p.name} to ₹${nextInr.toLocaleString('en-IN')}`);
                      }}
                    >
                      <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '800' }}>Save ₹</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* 2. DAILY BONUS */}
      {subTab === 'daily' && (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 10 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>Daily Check-In Bonus</Text>
            <Switch
              value={configDraft.dailyBonusEnabled}
              onValueChange={(v) => setConfigDraft((p) => ({ ...p, dailyBonusEnabled: v }))}
            />
          </View>
          <Text style={{ color: c.muted, fontSize: 11 }}>Daily Bonus Coins</Text>
          <TextInput
            keyboardType="numeric"
            value={String(configDraft.dailyBonusCoins)}
            onChangeText={(t) => setConfigDraft((p) => ({ ...p, dailyBonusCoins: Math.max(0, Number(t) || 0) }))}
            style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
          />
          <TouchableOpacity
            disabled={busy}
            style={[styles.btn, { backgroundColor: c.teal }]}
            onPress={() => void handleSaveConfig('Daily Bonus')}
          >
            <Text style={{ color: '#FFF', fontWeight: '800' }}>Save Daily Bonus</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 3. WEEKLY BONUS */}
      {subTab === 'weekly' && (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 10 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>Weekly Bonus (Default: 60c)</Text>
            <Switch
              value={configDraft.weeklyBonusEnabled}
              onValueChange={(v) => setConfigDraft((p) => ({ ...p, weeklyBonusEnabled: v }))}
            />
          </View>
          <Text style={{ color: c.muted, fontSize: 11 }}>Weekly Bonus Coins</Text>
          <TextInput
            keyboardType="numeric"
            value={String(configDraft.weeklyBonusCoins)}
            onChangeText={(t) => setConfigDraft((p) => ({ ...p, weeklyBonusCoins: Math.max(0, Number(t) || 0) }))}
            style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
          />
          <Text style={{ color: c.muted, fontSize: 11 }}>Min Monthly Speaking Mins Eligibility</Text>
          <TextInput
            keyboardType="numeric"
            value={String(configDraft.weeklyMinSpeakingMinutes)}
            onChangeText={(t) =>
              setConfigDraft((p) => ({ ...p, weeklyMinSpeakingMinutes: Math.max(0, Number(t) || 0) }))
            }
            style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
          />
          <Text style={{ color: c.muted, fontSize: 11 }}>Schedule Weekday (UTC)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {[
              { v: -1, l: 'Any' },
              { v: 1, l: 'Mon' },
              { v: 3, l: 'Wed' },
              { v: 5, l: 'Fri' },
              { v: 6, l: 'Sat' },
              { v: 0, l: 'Sun' },
            ].map((d) => (
              <TouchableOpacity
                key={d.v}
                style={[
                  styles.subPill,
                  {
                    backgroundColor: configDraft.weeklyBonusWeekdayUtc === d.v ? c.teal : c.bg,
                    borderColor: c.border,
                  },
                ]}
                onPress={() => setConfigDraft((p) => ({ ...p, weeklyBonusWeekdayUtc: d.v }))}
              >
                <Text style={{ color: configDraft.weeklyBonusWeekdayUtc === d.v ? '#FFF' : c.text, fontSize: 11 }}>
                  {d.l}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity
            disabled={busy}
            style={[styles.btn, { backgroundColor: c.teal }]}
            onPress={() => void handleSaveConfig('Weekly Bonus')}
          >
            <Text style={{ color: '#FFF', fontWeight: '800' }}>Save Weekly Bonus</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 4. MONTHLY BONUS */}
      {subTab === 'monthly' && (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 10 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>Monthly Bonus (Default: 200c)</Text>
            <Switch
              value={configDraft.monthlyBonusEnabled}
              onValueChange={(v) => setConfigDraft((p) => ({ ...p, monthlyBonusEnabled: v }))}
            />
          </View>
          <Text style={{ color: c.muted, fontSize: 11 }}>Monthly Bonus Coins</Text>
          <TextInput
            keyboardType="numeric"
            value={String(configDraft.monthlyBonusCoins)}
            onChangeText={(t) => setConfigDraft((p) => ({ ...p, monthlyBonusCoins: Math.max(0, Number(t) || 0) }))}
            style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.muted, fontSize: 11 }}>Day of Month (1–28)</Text>
              <TextInput
                keyboardType="numeric"
                value={String(configDraft.monthlyBonusDayOfMonth)}
                onChangeText={(t) =>
                  setConfigDraft((p) => ({
                    ...p,
                    monthlyBonusDayOfMonth: Math.min(28, Math.max(1, Number(t) || 1)),
                  }))
                }
                style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.muted, fontSize: 11 }}>Min Level (0–5)</Text>
              <TextInput
                keyboardType="numeric"
                value={String(configDraft.monthlyMinLevel)}
                onChangeText={(t) =>
                  setConfigDraft((p) => ({
                    ...p,
                    monthlyMinLevel: Math.min(5, Math.max(0, Number(t) || 0)),
                  }))
                }
                style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
            </View>
          </View>
          <Text style={{ color: c.muted, fontSize: 11 }}>Min Monthly Speaking Mins</Text>
          <TextInput
            keyboardType="numeric"
            value={String(configDraft.monthlyMinSpeakingMinutes)}
            onChangeText={(t) =>
              setConfigDraft((p) => ({ ...p, monthlyMinSpeakingMinutes: Math.max(0, Number(t) || 0) }))
            }
            style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
          />
          <TouchableOpacity
            disabled={busy}
            style={[styles.btn, { backgroundColor: c.teal }]}
            onPress={() => void handleSaveConfig('Monthly Bonus')}
          >
            <Text style={{ color: '#FFF', fontWeight: '800' }}>Save Monthly Bonus</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 5. SPEAKING REWARDS */}
      {subTab === 'speaking' && (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 10 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>Speaking Rewards</Text>
            <Switch
              value={configDraft.speakingRewardEnabled}
              onValueChange={(v) => setConfigDraft((p) => ({ ...p, speakingRewardEnabled: v }))}
            />
          </View>
          <Text style={{ color: c.muted, fontSize: 11 }}>
            Only verified active mic speech in live rooms counts; muted/idle/background time never qualifies.
          </Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.muted, fontSize: 11 }}>Mins/Reward</Text>
              <TextInput
                keyboardType="numeric"
                value={String(configDraft.speakingMinutesPerReward)}
                onChangeText={(t) =>
                  setConfigDraft((p) => ({ ...p, speakingMinutesPerReward: Math.max(1, Number(t) || 1) }))
                }
                style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.muted, fontSize: 11 }}>Coins/Reward</Text>
              <TextInput
                keyboardType="numeric"
                value={String(configDraft.speakingRewardCoins)}
                onChangeText={(t) =>
                  setConfigDraft((p) => ({ ...p, speakingRewardCoins: Math.max(0, Number(t) || 0) }))
                }
                style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.muted, fontSize: 11 }}>Daily Max</Text>
              <TextInput
                keyboardType="numeric"
                value={String(configDraft.speakingDailyMaxCoins)}
                onChangeText={(t) =>
                  setConfigDraft((p) => ({ ...p, speakingDailyMaxCoins: Math.max(0, Number(t) || 0) }))
                }
                style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
            </View>
          </View>
          <TouchableOpacity
            disabled={busy}
            style={[styles.btn, { backgroundColor: c.teal }]}
            onPress={() => void handleSaveConfig('Speaking Rewards')}
          >
            <Text style={{ color: '#FFF', fontWeight: '800' }}>Save Speaking Rules</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 6. HOSTING BONUS */}
      {subTab === 'hosting' && (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 10 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>Hosting Bonus</Text>
            <Switch
              value={configDraft.hostingBonusEnabled}
              onValueChange={(v) => setConfigDraft((p) => ({ ...p, hostingBonusEnabled: v }))}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['per_minute', 'per_hour'] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[
                  styles.subPill,
                  {
                    backgroundColor: configDraft.hostingRateMode === m ? c.teal : c.bg,
                    borderColor: c.border,
                  },
                ]}
                onPress={() => setConfigDraft((p) => ({ ...p, hostingRateMode: m }))}
              >
                <Text style={{ color: configDraft.hostingRateMode === m ? '#FFF' : c.text, fontSize: 11 }}>
                  {m === 'per_hour' ? 'Per Hour' : 'Per Minute'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.muted, fontSize: 11 }}>Coins/Unit</Text>
              <TextInput
                keyboardType="numeric"
                value={String(configDraft.hostingCoinsPerUnit)}
                onChangeText={(t) =>
                  setConfigDraft((p) => ({ ...p, hostingCoinsPerUnit: Math.max(0, Number(t) || 0) }))
                }
                style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.muted, fontSize: 11 }}>Min Users</Text>
              <TextInput
                keyboardType="numeric"
                value={String(configDraft.hostingMinListeners)}
                onChangeText={(t) =>
                  setConfigDraft((p) => ({ ...p, hostingMinListeners: Math.max(1, Number(t) || 1) }))
                }
                style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.muted, fontSize: 11 }}>Daily Limit</Text>
              <TextInput
                keyboardType="numeric"
                value={String(configDraft.hostingDailyMaxCoins)}
                onChangeText={(t) =>
                  setConfigDraft((p) => ({ ...p, hostingDailyMaxCoins: Math.max(0, Number(t) || 0) }))
                }
                style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.muted, fontSize: 11 }}>Monthly Limit</Text>
              <TextInput
                keyboardType="numeric"
                value={String(configDraft.hostingMonthlyMaxCoins)}
                onChangeText={(t) =>
                  setConfigDraft((p) => ({ ...p, hostingMonthlyMaxCoins: Math.max(0, Number(t) || 0) }))
                }
                style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
            </View>
          </View>
          <TouchableOpacity
            disabled={busy}
            style={[styles.btn, { backgroundColor: c.teal }]}
            onPress={() => void handleSaveConfig('Hosting Bonus')}
          >
            <Text style={{ color: '#FFF', fontWeight: '800' }}>Save Hosting Rules</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 7. PROMOTIONAL POOL */}
      {subTab === 'promotional' && (
        <View style={{ gap: 10 }}>
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 6 }]}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>Promotional Reward Pool</Text>
            <Text style={{ color: c.muted, fontSize: 12 }}>
              Issued: {pool?.issuedBudget ?? 0}c · Distributed: {pool?.distributedCoins ?? 0}c · Remaining:{' '}
              {pool?.remainingBudget ?? 0}c · Status: {pool?.paused ? 'PAUSED' : 'ACTIVE'}
            </Text>
            <TouchableOpacity
              disabled={busy}
              style={[styles.smallBtn, { backgroundColor: pool?.paused ? c.teal : c.danger }]}
              onPress={async () => {
                if (!pool) return;
                setBusy(true);
                try {
                  await updateOwnerPromoPool({ action: 'set_paused', paused: !pool.paused });
                  onToast(!pool.paused ? 'Promotional pool paused.' : 'Promotional pool resumed.');
                  await loadOverview();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '800' }}>
                {pool?.paused ? 'Resume Promotional Rewards' : 'Pause All Promotional Rewards'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 13 }}>Issue Promotional Budget</Text>
            <TextInput
              keyboardType="numeric"
              placeholder="Coins to add"
              value={issueAmount}
              onChangeText={setIssueAmount}
              style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
            <TextInput
              placeholder="Audit Note"
              placeholderTextColor={c.muted}
              value={issueNote}
              onChangeText={setIssueNote}
              style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
            <TouchableOpacity
              disabled={busy}
              style={[styles.btn, { backgroundColor: c.teal }]}
              onPress={async () => {
                setBusy(true);
                try {
                  await updateOwnerPromoPool({
                    action: 'issue_budget',
                    amount: Math.floor(Number(issueAmount) || 0),
                    note: issueNote,
                  });
                  onToast('Budget added to Promotional Pool!');
                  await loadOverview();
                } catch (err) {
                  onToast(err instanceof Error ? err.message : 'Failed to issue budget');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Text style={{ color: '#FFF', fontWeight: '800' }}>Add Promotional Budget</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 13 }}>Safety Caps &amp; Direct Promo Grant</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TextInput
                keyboardType="numeric"
                placeholder="Daily Cap"
                value={dailyCapDraft}
                onChangeText={setDailyCapDraft}
                style={[styles.input, { flex: 1, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
              <TextInput
                keyboardType="numeric"
                placeholder="Monthly Cap"
                value={monthlyCapDraft}
                onChangeText={setMonthlyCapDraft}
                style={[styles.input, { flex: 1, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
              <TextInput
                keyboardType="numeric"
                placeholder="Max Single"
                value={maxSingleDraft}
                onChangeText={setMaxSingleDraft}
                style={[styles.input, { flex: 1, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
            </View>
            <TouchableOpacity
              disabled={busy}
              style={[styles.btn, { backgroundColor: c.marigold }]}
              onPress={async () => {
                setBusy(true);
                try {
                  await updateOwnerPromoPool({
                    action: 'update_limits',
                    perUserDailyCap: Math.floor(Number(dailyCapDraft) || 0),
                    perUserMonthlyCap: Math.floor(Number(monthlyCapDraft) || 0),
                    maxSingleReward: Math.floor(Number(maxSingleDraft) || 100),
                  });
                  onToast('Caps saved!');
                  await loadOverview();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Text style={{ color: '#14171A', fontWeight: '800' }}>Save Promo Caps</Text>
            </TouchableOpacity>

            <TextInput
              placeholder="Target User UID for Direct Promo Grant"
              placeholderTextColor={c.muted}
              value={promoGrantUid}
              onChangeText={setPromoGrantUid}
              style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TextInput
                keyboardType="numeric"
                placeholder="Coins"
                value={promoGrantAmt}
                onChangeText={setPromoGrantAmt}
                style={[styles.input, { width: 90, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
              <TextInput
                placeholder="Note"
                placeholderTextColor={c.muted}
                value={promoGrantNote}
                onChangeText={setPromoGrantNote}
                style={[styles.input, { flex: 1, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
            </View>
            <TouchableOpacity
              disabled={busy}
              style={[styles.btn, { backgroundColor: c.teal }]}
              onPress={async () => {
                if (!promoGrantUid.trim()) {
                  onToast('Enter target User UID.');
                  return;
                }
                setBusy(true);
                try {
                  await updateOwnerPromoPool({
                    action: 'manual_promo_grant',
                    targetUid: promoGrantUid.trim(),
                    amount: Math.floor(Number(promoGrantAmt) || 0),
                    note: promoGrantNote,
                  });
                  onToast('Promotional coins granted!');
                  await loadOverview();
                  await onRefreshParent();
                } catch (err) {
                  onToast(err instanceof Error ? err.message : 'Grant failed');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Text style={{ color: '#FFF', fontWeight: '800' }}>Grant Promotional Coins (Audited)</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 6 }]}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 13 }}>
              Promotional Ledger ({ledger.length})
            </Text>
            {ledger.slice(0, 25).map((e) => (
              <View key={e.id} style={{ paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: c.border }}>
                <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }}>
                  [{e.entryType}] {e.note}
                </Text>
                <Text style={{ color: c.muted, fontSize: 11 }}>
                  {e.username} · Remaining: {e.remainingAfter}c
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* 8. GIFT PRICING */}
      {subTab === 'gifts' && (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 10 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>
              Virtual Gifts Catalog ({gifts.length})
            </Text>
            <TouchableOpacity
              onPress={async () => {
                for (const item of DEFAULT_VIRTUAL_GIFTS) await saveVirtualGift(item);
                await onAudit('seed_default_gifts', 'virtualGift', 'catalog', `Synced ${DEFAULT_VIRTUAL_GIFTS.length} gifts`);
                onToast(`Synced ${DEFAULT_VIRTUAL_GIFTS.length} default gifts!`);
              }}
            >
              <Text style={{ color: c.teal, fontSize: 11, fontWeight: '800' }}>Sync 8 Defaults</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TextInput
              placeholder="Emoji"
              value={giftEmoji}
              onChangeText={setGiftEmoji}
              style={[styles.input, { width: 54, textAlign: 'center', borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
            <TextInput
              placeholder="Gift Name"
              placeholderTextColor={c.muted}
              value={giftName}
              onChangeText={setGiftName}
              style={[styles.input, { flex: 1, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
            <TextInput
              placeholder="Price"
              keyboardType="numeric"
              value={giftPrice}
              onChangeText={setGiftPrice}
              style={[styles.input, { width: 72, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {(['float', 'burst', 'crown', 'sparkle', 'couple_love'] as const).map((anim) => (
              <TouchableOpacity
                key={anim}
                onPress={() => setGiftAnim(anim)}
                style={[styles.subPill, { backgroundColor: giftAnim === anim ? c.teal : c.bg, borderColor: c.border }]}
              >
                <Text style={{ color: giftAnim === anim ? '#FFF' : c.text, fontSize: 11, fontWeight: '700' }}>
                  {anim === 'couple_love' ? 'Love Couple' : anim}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: c.teal }]}
            onPress={async () => {
              if (!giftName.trim()) return;
              const giftId = makeId('gift');
              const parsed = Math.max(1, Math.floor(Number(giftPrice) || 50));
              await saveVirtualGift({
                id: giftId,
                name: giftName.trim(),
                emoji: giftEmoji || '🎁',
                category: giftAnim === 'couple_love' || giftAnim === 'crown' ? 'royal' : 'celebration',
                coinPrice: parsed,
                animationType: giftAnim,
                active: true,
              });
              await onAudit('create_gift', 'virtualGift', giftId, `${giftName.trim()} (${parsed}c)`);
              setGiftName('');
              onToast('Gift added!');
            }}
          >
            <Text style={{ color: '#FFF', fontWeight: '800' }}>Add Virtual Gift</Text>
          </TouchableOpacity>

          {gifts.map((g) => {
            const draftPrice = editingGiftPrices[g.id] ?? String(g.coinPrice);
            return (
              <View
                key={g.id}
                style={{
                  borderWidth: 1,
                  borderColor: g.animationType === 'couple_love' ? '#F43F5E' : c.border,
                  borderRadius: 14,
                  padding: 10,
                  gap: 8,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontSize: 13, fontWeight: '800' }}>
                      {g.emoji} {g.name}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 11 }}>
                      {g.coinPrice} 🪙 · {g.animationType} · {g.active ? 'Active' : 'Disabled'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity
                      style={[styles.smallBtn, { borderWidth: 1, borderColor: g.active ? c.teal : c.border }]}
                      onPress={async () => {
                        await saveVirtualGift({ ...g, active: !g.active });
                        onToast(`${g.name} ${!g.active ? 'enabled' : 'disabled'}`);
                      }}
                    >
                      <Text style={{ color: g.active ? c.teal : c.muted, fontSize: 11, fontWeight: '800' }}>
                        {g.active ? 'Active' : 'Off'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.smallBtn, { backgroundColor: `${c.danger}1A` }]}
                      onPress={() => deleteVirtualGift(g.id)}
                    >
                      <Text style={{ color: c.danger, fontSize: 11, fontWeight: '800' }}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <TextInput
                    keyboardType="numeric"
                    value={draftPrice}
                    onChangeText={(txt) => setEditingGiftPrices((p) => ({ ...p, [g.id]: txt }))}
                    style={[styles.input, { flex: 1, height: 36, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
                  />
                  <TouchableOpacity
                    style={[styles.smallBtn, { height: 36, backgroundColor: c.teal }]}
                    onPress={async () => {
                      const nextPrice = Math.floor(Number(draftPrice));
                      if (!Number.isFinite(nextPrice) || nextPrice < 1) {
                        onToast('Enter a valid coin price (min 1).');
                        return;
                      }
                      await saveVirtualGift({ ...g, coinPrice: nextPrice });
                      onToast(`Updated ${g.name} price to ${nextPrice} coins`);
                    }}
                  >
                    <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '800' }}>Save Price</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* 9. USER WALLETS */}
      {subTab === 'wallets' && (
        <View style={{ gap: 10 }}>
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>Manual Wallet Adjustment</Text>
            <TextInput
              placeholder="Target User UID"
              placeholderTextColor={c.muted}
              value={walletTargetUid}
              onChangeText={setWalletTargetUid}
              style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
            <TextInput
              placeholder="Coins Delta (e.g. 500 or -50)"
              keyboardType="numeric"
              value={walletDelta}
              onChangeText={setWalletDelta}
              style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: c.teal }]}
              onPress={async () => {
                if (!walletTargetUid.trim()) return;
                await adjustUserWalletOwner({
                  ownerActor: currentUser,
                  targetUid: walletTargetUid.trim(),
                  deltaCoins: Number(walletDelta) || 0,
                  note: 'Owner mobile wallet adjustment',
                });
                onToast('Wallet adjusted!');
                await onRefreshParent();
              }}
            >
              <Text style={{ color: '#FFF', fontWeight: '800' }}>Apply Wallet Adjustment</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 6 }]}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>
              Wallets ({wallets.length}) · Purchased vs Promotional
            </Text>
            {wallets.map((w) => {
              const u = userByUid.get(w.uid);
              return (
                <View key={w.uid} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border }}>
                  <Text style={{ color: c.text, fontWeight: '700', fontSize: 12 }}>
                    {u ? `@${u.username}` : w.uid} · Bal: {w.coinsBalance}c
                  </Text>
                  <Text style={{ color: c.muted, fontSize: 11 }}>
                    Purchased: {w.totalPurchased ?? 0}c · Promo: {w.totalPromotionalEarned ?? 0}c · Beans: {w.earnedBeans ?? 0}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* 10. TRANSACTION HISTORY & ORDERS */}
      {subTab === 'transactions' && (
        <View style={{ gap: 10 }}>
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>
              Coin Purchase Orders ({topups.filter((t) => t.status === 'pending').length} pending)
            </Text>
            {topups.map((tp) => (
              <View key={tp.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border, gap: 4 }}>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 12 }}>
                  @{tp.username}: {tp.packageName} (+{tp.coins}c) · {tp.status.toUpperCase()}
                </Text>
                {tp.status === 'pending' && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      style={[styles.smallBtn, { backgroundColor: c.teal }]}
                      onPress={async () => {
                        await reviewCoinTopupRequestOwner(tp, 'approved', 'Approved via mobile owner panel', currentUser);
                        await onRefreshParent();
                      }}
                    >
                      <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700' }}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.smallBtn, { backgroundColor: c.danger }]}
                      onPress={async () => {
                        await reviewCoinTopupRequestOwner(tp, 'rejected', 'Rejected by owner', currentUser);
                        await onRefreshParent();
                      }}
                    >
                      <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700' }}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))}
          </View>

          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>
              Transaction History ({filteredTx.length})
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {(['all', 'purchased', 'promotional', 'gifts'] as const).map((f) => (
                <TouchableOpacity
                  key={f}
                  style={[styles.subPill, { backgroundColor: txFilter === f ? c.teal : c.bg, borderColor: c.border }]}
                  onPress={() => setTxFilter(f)}
                >
                  <Text style={{ color: txFilter === f ? '#FFF' : c.text, fontSize: 11, fontWeight: '700' }}>
                    {f.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {filteredTx.slice(0, 40).map((tx) => (
              <View key={tx.id} style={{ paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: c.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: c.text, fontSize: 12, flex: 1 }}>{tx.note}</Text>
                  <Text style={{ color: tx.coinsDelta >= 0 ? c.teal : c.danger, fontSize: 12, fontWeight: '800' }}>
                    {tx.coinsDelta >= 0 ? `+${tx.coinsDelta}` : tx.coinsDelta}
                  </Text>
                </View>
                <Text style={{ color: c.muted, fontSize: 10 }}>
                  {tx.type} {tx.coinSource ? `(${tx.coinSource})` : ''} · {formatRelativeTime(tx.createdAt)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 14 },
  subPill: { height: 32, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, justifyContent: 'center' },
  smallBtn: { height: 32, paddingHorizontal: 10, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  btn: { height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  input: { height: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 13 },
});
