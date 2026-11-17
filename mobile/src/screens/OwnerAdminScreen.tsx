import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LevelBadge } from '../components/LevelBadge';
import { OwnerCoinEconomyPanel } from '../components/OwnerCoinEconomyPanel';
import { auth } from '../config/firebase';
import { PALETTE } from '../i18n/translations';
import {
  adminDeletePost,
  AdminLookupResponse,
  adminReplySupportTicket,
  adminSetPostStatus,
  adminSetUserSuspended,
  adminSetUserVerified,
  adminUpdateReport,
  banAudioParticipant,
  computeLevelSummary,
  createAnnouncement,
  DEFAULT_COIN_PACKAGES,
  DEFAULT_VIRTUAL_GIFTS,
  deleteAnnouncement,
  endAudioRoom,
  endLiveStream,
  exportFullPlatformBackupJson,
  fetchOwnerDashboardData,
  fetchUserSpeakingHistory,
  formatRelativeTime,
  formatSpeakingDuration,
  logAdminAction,
  ownerCreateAdminOrModerator,
  ownerLookupUserForAdmin,
  ownerRemoveAdminOrModerator,
  ownerUpdateAdminStatusOrRole,
  saveAppSettings,
  saveLevelConfigAdmin,
  subscribeAudioParticipants,
  subscribeCoinPackages,
  subscribeVirtualGifts,
  toggleParticipantMute,
} from '../services/api';
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

interface OwnerAdminScreenProps {
  currentUser: UserProfile;
  isOriginalOwner: boolean;
  hasAdminAccess?: boolean;
  ownerUid?: string | null;
  ownerBackendVerified?: boolean;
  liveStreams: LiveStream[];
  appSettings: AppSettings;
  levelConfig: LevelConfig;
  speakingStatsMap: Record<string, SpeakingStats>;
  darkMode: boolean;
  onToast: (msg: string) => void;
}

type Section = 'overview' | 'users' | 'audio' | 'levels' | 'economy' | 'content' | 'settings' | 'audit';

export const OwnerAdminScreen: React.FC<OwnerAdminScreenProps> = ({
  currentUser,
  isOriginalOwner,
  hasAdminAccess = true,
  ownerUid: verifiedOwnerUidProp,
  ownerBackendVerified = false,
  liveStreams,
  appSettings,
  levelConfig,
  speakingStatsMap,
  darkMode,
  onToast,
}) => {
  const canAccess = isOriginalOwner || hasAdminAccess;
  const c = darkMode ? PALETTE.dark : PALETTE.light;
  const [section, setSection] = useState<Section>('overview');
  const [loading, setLoading] = useState(true);

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [audioRooms, setAudioRooms] = useState<AudioRoom[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<AudioRoom | null>(null);
  const [roomParts, setRoomParts] = useState<AudioRoomParticipant[]>([]);
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [topups, setTopups] = useState<CoinTopupRequest[]>([]);
  const [wallets, setWallets] = useState<UserWallet[]>([]);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  const [gifts, setGifts] = useState<VirtualGift[]>(DEFAULT_VIRTUAL_GIFTS);
  const [packages, setPackages] = useState<CoinPackage[]>(DEFAULT_COIN_PACKAGES);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(appSettings);
  const [levelDraft, setLevelDraft] = useState<LevelConfig>(levelConfig);
  const [inspectedUserHistory, setInspectedUserHistory] = useState<{
    name: string;
    items: SpeakingMonthHistory[];
  } | null>(null);

  // Forms
  const [annTitle, setAnnTitle] = useState('');
  const [annMsg, setAnnMsg] = useState('');
  const [adminIdentifier, setAdminIdentifier] = useState('');
  const [adminRoleChoice, setAdminRoleChoice] = useState<'admin' | 'moderator'>('moderator');
  const [adminNotes, setAdminNotes] = useState('');
  const [adminActionBusy, setAdminActionBusy] = useState(false);
  const [lookingUpUser, setLookingUpUser] = useState(false);
  const [lookupResult, setLookupResult] = useState<AdminLookupResponse | null>(null);
  const [adminFormError, setAdminFormError] = useState<string | null>(null);

  const actorRole: 'owner' | 'admin' = isOriginalOwner ? 'owner' : 'admin';

  const loadAll = async () => {
    setLoading(true);
    try {
      const data = await fetchOwnerDashboardData(isOriginalOwner);
      setUsers(data.users);
      setAdmins(data.admins);
      setAudioRooms(data.audioRooms);
      setReports(data.reports);
      setPosts(data.posts);
      setTickets(data.tickets);
      setAnnouncements(data.announcements);
      setTopups(data.topups);
      setWallets(data.wallets);
      setTransactions(data.transactions);
      setAuditLogs(data.auditLogs);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    void loadAll();
    const u1 = subscribeVirtualGifts(setGifts);
    const u2 = subscribeCoinPackages(setPackages);
    return () => {
      u1();
      u2();
    };
  }, [isOriginalOwner, canAccess]);

  useEffect(() => {
    setSettingsDraft(appSettings);
  }, [appSettings]);

  useEffect(() => {
    setLevelDraft(levelConfig);
  }, [levelConfig]);

  useEffect(() => {
    if (!selectedRoom) {
      setRoomParts([]);
      return;
    }
    return subscribeAudioParticipants(selectedRoom.id, setRoomParts);
  }, [selectedRoom?.id]);

  const ownerUid = verifiedOwnerUidProp || appSettings.ownerUid || (isOriginalOwner ? currentUser.uid : '');
  const totalGiftCoins = useMemo(
    () => transactions.filter((t) => t.type === 'gift_sent').reduce((s, t) => s + Math.abs(t.coinsDelta), 0),
    [transactions]
  );

  const activeVipCount = useMemo(
    () =>
      Object.values(speakingStatsMap).filter((st) => computeLevelSummary(st, levelConfig).isVip).length,
    [speakingStatsMap, levelConfig]
  );

  const speakingLeaderboard = useMemo(() => {
    return [...users]
      .map((u) => {
        const stats = speakingStatsMap[u.uid] || null;
        const summary = computeLevelSummary(stats, levelConfig);
        return { user: u, stats, summary };
      })
      .sort((a, b) => b.summary.activeSeconds - a.summary.activeSeconds);
  }, [users, speakingStatsMap, levelConfig]);

  const audit = async (action: string, targetType: string, targetId: string, details: string) => {
    await logAdminAction({
      actor: currentUser,
      actorRole,
      action,
      targetType,
      targetId,
      details,
    }).catch(() => {});
  };

  const tabs: { id: Section; label: string; ownerOnly?: boolean }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Users & Admins' },
    { id: 'audio', label: 'Audio Rooms' },
    { id: 'levels', label: 'Levels & VIP' },
    { id: 'economy', label: 'Coin Economy', ownerOnly: true },
    { id: 'content', label: 'Moderation' },
    { id: 'settings', label: 'Settings', ownerOnly: true },
    { id: 'audit', label: 'Audit & Backup', ownerOnly: true },
  ];

  if (!canAccess) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: c.text, fontWeight: '900', fontSize: 18 }}>Access Restricted</Text>
        <Text style={{ color: c.muted, fontSize: 13, textAlign: 'center', marginTop: 8 }}>
          The Super Admin Owner Dashboard is strictly reserved for the verified BANDHU MELA owner.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[styles.topBar, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontWeight: '900', fontSize: 15 }}>
              {isOriginalOwner ? 'SUPER ADMIN OWNER CONTROL' : 'MODERATOR PANEL'}
            </Text>
            <Text style={{ color: c.teal, fontSize: 11 }}>
              {isOriginalOwner
                ? `UID: ${ownerUid || currentUser.uid} · ${ownerBackendVerified ? 'Backend Locked' : 'Registry Locked'}`
                : auth.currentUser?.email || `@${currentUser.username}`}
            </Text>
          </View>
        <TouchableOpacity style={[styles.smallBtn, { borderWidth: 1, borderColor: c.border }]} onPress={loadAll}>
          <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }}>Refresh</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ maxHeight: 50, borderBottomWidth: 1, borderBottomColor: c.border }}
        contentContainerStyle={{ paddingHorizontal: 10, alignItems: 'center', gap: 6 }}
      >
        {tabs
          .filter((tb) => !tb.ownerOnly || isOriginalOwner)
          .map((tb) => (
            <TouchableOpacity
              key={tb.id}
              style={[
                styles.tabPill,
                { backgroundColor: section === tb.id ? c.teal : c.surface, borderColor: c.border },
              ]}
              onPress={() => setSection(tb.id)}
            >
              <Text style={{ color: section === tb.id ? '#FFF' : c.text, fontSize: 12, fontWeight: '700' }}>
                {tb.label}
              </Text>
            </TouchableOpacity>
          ))}
      </ScrollView>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={c.teal} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 40 }}>
          {section === 'overview' && (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {[
                  ['Users', users.length],
                  ['Posts', posts.length],
                  ['Live Audio', audioRooms.filter((r) => r.status === 'live').length],
                  ['Active VIPs', activeVipCount],
                  ['Gift Coins', totalGiftCoins],
                  ['Open Reports', reports.filter((r) => r.status === 'open').length],
                  ['Pending Topups', topups.filter((t) => t.status === 'pending').length],
                ].map(([label, val]) => (
                  <View key={String(label)} style={[styles.statBox, { backgroundColor: c.surface, borderColor: c.border }]}>
                    <Text style={{ color: c.muted, fontSize: 11 }}>{label}</Text>
                    <Text style={{ color: c.text, fontSize: 20, fontWeight: '900', marginTop: 2 }}>{val}</Text>
                  </View>
                ))}
              </View>

              <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>Publish Announcement</Text>
                <TextInput
                  placeholder="Title"
                  placeholderTextColor={c.muted}
                  value={annTitle}
                  onChangeText={setAnnTitle}
                  style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
                />
                <TextInput
                  placeholder="Announcement message"
                  placeholderTextColor={c.muted}
                  value={annMsg}
                  onChangeText={setAnnMsg}
                  style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
                />
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: c.teal }]}
                  onPress={async () => {
                    if (!annTitle.trim() || !annMsg.trim()) return;
                    await createAnnouncement({
                      author: currentUser,
                      title: annTitle,
                      message: annMsg,
                      priority: 'important',
                    });
                    await audit('publish_announcement', 'announcement', annTitle, annMsg);
                    setAnnTitle('');
                    setAnnMsg('');
                    onToast('Announcement live!');
                    void loadAll();
                  }}
                >
                  <Text style={{ color: '#FFF', fontWeight: '800' }}>Broadcast Notice</Text>
                </TouchableOpacity>
                {announcements.map((an) => (
                  <View
                    key={an.id}
                    style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6 }}
                  >
                    <Text style={{ color: c.text, fontSize: 12, flex: 1 }}>{an.title}</Text>
                    <TouchableOpacity
                      onPress={async () => {
                        await deleteAnnouncement(an.id);
                        void loadAll();
                      }}
                    >
                      <Text style={{ color: c.danger, fontSize: 12, fontWeight: '700' }}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          )}

          {section === 'users' && (
            <View style={{ gap: 10 }}>
              {isOriginalOwner && (
                <>
                  {/* Protected Original Owner Card */}
                  <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.marigold, gap: 6 }]}>
                    <Text style={{ color: c.text, fontWeight: '900', fontSize: 14 }}>
                      Original Owner · Permanently Protected
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 11 }}>
                      UID: {ownerUid || currentUser.uid} · Only the verified Original Owner can create, suspend, reactivate, or remove Admins &amp; Moderators.
                    </Text>
                  </View>

                  {/* Create Admin or Moderator Form */}
                  <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
                    <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>
                      Create Admin or Moderator
                    </Text>
                    <TextInput
                      placeholder="Registered user email or Firebase UID"
                      placeholderTextColor={c.muted}
                      value={adminIdentifier}
                      onChangeText={(txt) => {
                        setAdminIdentifier(txt);
                        setAdminFormError(null);
                        if (lookupResult) setLookupResult(null);
                      }}
                      autoCapitalize="none"
                      style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
                    />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {(['moderator', 'admin'] as const).map((r) => (
                        <TouchableOpacity
                          key={r}
                          onPress={() => setAdminRoleChoice(r)}
                          style={[
                            styles.smallBtn,
                            {
                              flex: 1,
                              alignItems: 'center',
                              backgroundColor: adminRoleChoice === r ? c.teal : c.bg,
                              borderWidth: 1,
                              borderColor: adminRoleChoice === r ? c.teal : c.border,
                            },
                          ]}
                        >
                          <Text
                            style={{
                              color: adminRoleChoice === r ? '#FFF' : c.text,
                              fontWeight: '800',
                              fontSize: 12,
                            }}
                          >
                            {r === 'admin' ? 'Admin' : 'Moderator'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput
                      placeholder="Optional role notes"
                      placeholderTextColor={c.muted}
                      value={adminNotes}
                      onChangeText={setAdminNotes}
                      style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
                    />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        style={[
                          styles.smallBtn,
                          {
                            borderWidth: 1,
                            borderColor: c.teal,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                            opacity: lookingUpUser ? 0.6 : 1,
                          },
                        ]}
                        disabled={lookingUpUser || adminActionBusy}
                        onPress={async () => {
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
                            const found = await ownerLookupUserForAdmin(clean);
                            setLookupResult(found);
                            onToast(`Matched: ${found.user.displayName} (@${found.user.username || 'member'})`);
                          } catch (err) {
                            const msg = err instanceof Error ? err.message : 'User lookup failed';
                            setLookupResult(null);
                            setAdminFormError(msg);
                            onToast(msg);
                          } finally {
                            setLookingUpUser(false);
                          }
                        }}
                      >
                        {lookingUpUser && <ActivityIndicator size="small" color={c.teal} />}
                        <Text style={{ color: c.text, fontWeight: '700', fontSize: 12 }}>
                          {lookingUpUser ? 'Searching...' : 'Find User'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.btn,
                          {
                            flex: 1,
                            backgroundColor: c.teal,
                            opacity:
                              adminActionBusy || !adminIdentifier.trim() || Boolean(lookupResult?.isProtectedOwner)
                                ? 0.5
                                : 1,
                          },
                        ]}
                        disabled={adminActionBusy || !adminIdentifier.trim() || Boolean(lookupResult?.isProtectedOwner)}
                        onPress={async () => {
                          setAdminFormError(null);
                          setAdminActionBusy(true);
                          try {
                            const created = await ownerCreateAdminOrModerator({
                              identifier: adminIdentifier.trim(),
                              role: adminRoleChoice,
                              notes: adminNotes,
                            });
                            onToast(`Created ${created.role} for ${created.displayName || created.uid}`);
                            setAdminIdentifier('');
                            setAdminNotes('');
                            setLookupResult(null);
                            void loadAll();
                          } catch (err) {
                            const msg = err instanceof Error ? err.message : 'Creation failed';
                            setAdminFormError(msg);
                            onToast(msg);
                          } finally {
                            setAdminActionBusy(false);
                          }
                        }}
                      >
                        <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 13 }}>
                          Create {adminRoleChoice === 'admin' ? 'Admin' : 'Moderator'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {lookingUpUser && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 }}>
                        <ActivityIndicator size="small" color={c.teal} />
                        <Text style={{ color: c.teal, fontSize: 12, fontWeight: '600' }}>
                          Searching registered BANDHU MELA accounts...
                        </Text>
                      </View>
                    )}

                    {lookupResult && !lookingUpUser && (
                      <View
                        style={{
                          marginTop: 4,
                          padding: 10,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: c.teal,
                          backgroundColor: c.bg,
                          gap: 3,
                        }}
                      >
                        <Text style={{ color: c.text, fontWeight: '800', fontSize: 13 }}>
                          Name: {lookupResult.user.displayName} {lookupResult.user.isVerified ? '✓' : ''}
                        </Text>
                        <Text style={{ color: c.muted, fontSize: 12 }}>
                          Username: @{lookupResult.user.username || 'member'}
                        </Text>
                        <Text style={{ color: c.muted, fontSize: 12 }}>
                          Email: {lookupResult.user.email || 'Not stored in private profile'}
                        </Text>
                        <Text style={{ color: c.muted, fontSize: 11 }}>UID: {lookupResult.user.uid}</Text>
                        <Text
                          style={{
                            color: lookupResult.isProtectedOwner ? c.marigold : c.teal,
                            fontWeight: '800',
                            fontSize: 12,
                            marginTop: 2,
                          }}
                        >
                          Current Role:{' '}
                          {lookupResult.isProtectedOwner
                            ? 'ORIGINAL OWNER (PERMANENTLY PROTECTED)'
                            : lookupResult.existingAdmin
                            ? `${lookupResult.existingAdmin.role.toUpperCase()} (${
                                lookupResult.existingAdmin.isSuspended ? 'SUSPENDED' : 'ACTIVE'
                              })`
                            : 'USER (STANDARD MEMBER)'}
                        </Text>
                      </View>
                    )}

                    {adminFormError && (
                      <View
                        style={{
                          marginTop: 4,
                          padding: 10,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: c.danger,
                          backgroundColor: c.bg,
                        }}
                      >
                        <Text style={{ color: c.danger, fontSize: 12, fontWeight: '700' }}>
                          {adminFormError}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Existing Admin & Moderator Team */}
                  <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.marigold, gap: 8 }]}>
                    <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>
                      Admin &amp; Moderator Accounts (
                      {admins.filter((adm) => adm.uid !== ownerUid && adm.uid !== currentUser.uid).length})
                    </Text>
                    {admins
                      .filter((adm) => adm.uid !== ownerUid && adm.uid !== currentUser.uid)
                      .map((adm) => {
                        const currentRole: 'admin' | 'moderator' =
                          adm.role === 'admin' ? 'admin' : 'moderator';
                        const isSusp = Boolean(adm.isSuspended);
                        const label = adm.displayName || adm.uid;
                        return (
                          <View
                            key={adm.uid}
                            style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border, gap: 5 }}
                          >
                            <Text style={{ color: c.text, fontWeight: '700', fontSize: 13 }}>
                              {label} · {currentRole.toUpperCase()} · {isSusp ? 'SUSPENDED' : 'ACTIVE'}
                            </Text>
                            <Text style={{ color: c.muted, fontSize: 11 }}>
                              {adm.email ? `${adm.email} · ` : ''}UID: {adm.uid}
                            </Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                              <TouchableOpacity
                                onPress={() => {
                                  const nextRole = currentRole === 'admin' ? 'moderator' : 'admin';
                                  Alert.alert(
                                    'Confirm Role Change',
                                    `Change ${label} from ${currentRole} to ${nextRole}?`,
                                    [
                                      { text: 'Cancel', style: 'cancel' },
                                      {
                                        text: 'Confirm',
                                        onPress: async () => {
                                          try {
                                            await ownerUpdateAdminStatusOrRole(adm.uid, { role: nextRole });
                                            onToast(`Updated ${label} to ${nextRole}`);
                                            void loadAll();
                                          } catch (err) {
                                            onToast(err instanceof Error ? err.message : 'Update failed');
                                          }
                                        },
                                      },
                                    ]
                                  );
                                }}
                              >
                                <Text style={{ color: c.teal, fontSize: 12, fontWeight: '700' }}>
                                  Switch to {currentRole === 'admin' ? 'Mod' : 'Admin'}
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => {
                                  Alert.alert(
                                    isSusp ? 'Confirm Reactivate' : 'Confirm Suspend',
                                    `${isSusp ? 'Reactivate' : 'Suspend'} ${currentRole} privileges for ${label}?`,
                                    [
                                      { text: 'Cancel', style: 'cancel' },
                                      {
                                        text: 'Confirm',
                                        onPress: async () => {
                                          try {
                                            await ownerUpdateAdminStatusOrRole(adm.uid, { isSuspended: !isSusp });
                                            onToast(isSusp ? `Reactivated ${label}` : `Suspended ${label}`);
                                            void loadAll();
                                          } catch (err) {
                                            onToast(err instanceof Error ? err.message : 'Action failed');
                                          }
                                        },
                                      },
                                    ]
                                  );
                                }}
                              >
                                <Text style={{ color: isSusp ? c.teal : c.marigold, fontSize: 12, fontWeight: '700' }}>
                                  {isSusp ? 'Reactivate' : 'Suspend'}
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => {
                                  Alert.alert(
                                    'Confirm Remove',
                                    `Permanently remove ${currentRole} permissions from ${label}?`,
                                    [
                                      { text: 'Cancel', style: 'cancel' },
                                      {
                                        text: 'Remove',
                                        style: 'destructive',
                                        onPress: async () => {
                                          try {
                                            await ownerRemoveAdminOrModerator(adm.uid);
                                            onToast(`Removed ${label}`);
                                            void loadAll();
                                          } catch (err) {
                                            onToast(err instanceof Error ? err.message : 'Remove failed');
                                          }
                                        },
                                      },
                                    ]
                                  );
                                }}
                              >
                                <Text style={{ color: c.danger, fontSize: 12, fontWeight: '700' }}>Remove</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      })}
                  </View>
                </>
              )}

              {users.map((u) => {
                const isProtected = u.uid === currentUser.uid || (Boolean(ownerUid) && u.uid === ownerUid);
                const existingAdmin = admins.find((a) => a.uid === u.uid);
                return (
                  <View key={u.uid} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 6 }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <Text style={{ color: c.text, fontWeight: '800', fontSize: 14, flex: 1 }}>
                        {u.displayName} {isProtected ? '👑' : ''} {u.isVerified ? '✓' : ''}{' '}
                        {u.isSuspended ? '(SUSPENDED)' : ''}
                      </Text>
                      <LevelBadge stats={speakingStatsMap[u.uid]} config={levelConfig} compact />
                    </View>
                    <Text style={{ color: c.muted, fontSize: 11 }}>
                      @{u.username} · UID: {u.uid.slice(0, 14)}
                    </Text>
                    {!isProtected && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
                        <TouchableOpacity
                          onPress={async () => {
                            await adminSetUserVerified(u.uid, !u.isVerified);
                            await audit('verify_user', 'user', u.uid, String(!u.isVerified));
                            void loadAll();
                          }}
                        >
                          <Text style={{ color: c.teal, fontSize: 12, fontWeight: '700' }}>
                            {u.isVerified ? 'Unverify' : 'Verify'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={async () => {
                            await adminSetUserSuspended(u.uid, !u.isSuspended);
                            await audit('suspend_user', 'user', u.uid, String(!u.isSuspended));
                            void loadAll();
                          }}
                        >
                          <Text style={{ color: c.danger, fontSize: 12, fontWeight: '700' }}>
                            {u.isSuspended ? 'Unblock' : 'Suspend'}
                          </Text>
                        </TouchableOpacity>
                        {isOriginalOwner && !existingAdmin && (
                          <TouchableOpacity
                            onPress={async () => {
                              try {
                                await ownerCreateAdminOrModerator({ identifier: u.uid, role: 'moderator' });
                                onToast(`Granted Moderator to ${u.displayName}`);
                                void loadAll();
                              } catch (err) {
                                onToast(err instanceof Error ? err.message : 'Unable to grant Moderator');
                              }
                            }}
                          >
                            <Text style={{ color: c.marigold, fontSize: 12, fontWeight: '700' }}>Make Mod</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {section === 'audio' && (
            <View style={{ gap: 10 }}>
              {audioRooms.map((rm) => (
                <View key={rm.id} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 6 }]}>
                  <Text style={{ color: c.teal, fontSize: 11, fontWeight: '800' }}>
                    {rm.status.toUpperCase()} · {rm.visibility.toUpperCase()} · {rm.participantsCount} users
                    {rm.vipOnly ? ' · VIP ONLY' : ''}
                  </Text>
                  <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>{rm.title}</Text>
                  <Text style={{ color: c.muted, fontSize: 12 }}>Host: {rm.hostName}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      style={[styles.smallBtn, { borderWidth: 1, borderColor: c.border }]}
                      onPress={() => setSelectedRoom(rm)}
                    >
                      <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }}>Inspect Speakers</Text>
                    </TouchableOpacity>
                    {rm.status === 'live' && (
                      <TouchableOpacity
                        style={[styles.smallBtn, { backgroundColor: c.danger }]}
                        onPress={async () => {
                          await endAudioRoom(rm.id);
                          await audit('close_audio_room', 'audioRoom', rm.id, rm.title);
                          onToast('Room closed.');
                          void loadAll();
                        }}
                      >
                        <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>Close Room</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}

              {selectedRoom && (
                <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.marigold, gap: 8 }]}>
                  <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>
                    Participants in {selectedRoom.title}
                  </Text>
                  {roomParts.map((p) => (
                    <View
                      key={p.userId}
                      style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <Text style={{ color: c.text, fontSize: 12 }}>
                        {p.displayName} ({p.role})
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <TouchableOpacity
                          onPress={() => toggleParticipantMute(selectedRoom.id, p.userId, p.isMuted)}
                        >
                          <Text style={{ color: c.teal, fontSize: 12, fontWeight: '700' }}>
                            {p.isMuted ? 'Unmute' : 'Mute'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => banAudioParticipant(selectedRoom, p.userId)}>
                          <Text style={{ color: c.danger, fontSize: 12, fontWeight: '700' }}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {section === 'levels' && (
            <View style={{ gap: 12 }}>
              {/* 5 Tier Editor */}
              <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 10 }]}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>
                  Monthly Audio Level Thresholds &amp; VIP Perks
                </Text>
                {levelDraft.levels.map((tier, idx) => (
                  <View
                    key={tier.level}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingBottom: 6,
                      borderBottomWidth: 1,
                      borderBottomColor: c.border,
                    }}
                  >
                    <TextInput
                      value={tier.badgeEmoji}
                      onChangeText={(val) =>
                        setLevelDraft((prev) => ({
                          ...prev,
                          levels: prev.levels.map((l, i) => (i === idx ? { ...l, badgeEmoji: val } : l)),
                        }))
                      }
                      style={[
                        styles.input,
                        { width: 48, textAlign: 'center', borderColor: c.border, color: c.text, backgroundColor: c.bg },
                      ]}
                    />
                    <TextInput
                      value={tier.name}
                      onChangeText={(val) =>
                        setLevelDraft((prev) => ({
                          ...prev,
                          levels: prev.levels.map((l, i) => (i === idx ? { ...l, name: val } : l)),
                        }))
                      }
                      style={[styles.input, { flex: 1, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
                    />
                    <TextInput
                      value={String(tier.minHours)}
                      keyboardType="numeric"
                      onChangeText={(val) =>
                        setLevelDraft((prev) => ({
                          ...prev,
                          levels: prev.levels.map((l, i) =>
                            i === idx ? { ...l, minHours: Math.max(1, Number(val) || 1) } : l
                          ),
                        }))
                      }
                      style={[
                        styles.input,
                        { width: 64, textAlign: 'center', borderColor: c.border, color: c.text, backgroundColor: c.bg },
                      ]}
                    />
                    <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700' }}>hrs</Text>
                  </View>
                ))}

                {(
                  [
                    ['enableVipFrames', 'VIP Golden Profile Frames'],
                    ['enableVipNameColors', 'VIP Name Colors'],
                    ['enableVipExclusiveEmojis', 'VIP Exclusive Emojis'],
                    ['enableVipRoomAccess', 'VIP-Only Room Access'],
                    ['enableVipEntryAnimation', 'VIP Grand Entry Animation'],
                  ] as const
                ).map(([key, label]) => (
                  <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: c.text, fontSize: 13 }}>{label}</Text>
                    <Switch
                      value={Boolean(levelDraft[key])}
                      onValueChange={(val) => setLevelDraft((prev) => ({ ...prev, [key]: val }))}
                    />
                  </View>
                ))}

                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: c.teal }]}
                  onPress={async () => {
                    await saveLevelConfigAdmin(currentUser.uid, levelDraft);
                    await audit('update_level_config', 'appSettings', 'levelConfig', 'Updated level tiers & VIP perks');
                    onToast('Level & VIP configuration saved!');
                  }}
                >
                  <Text style={{ color: '#FFF', fontWeight: '800' }}>Save Level &amp; VIP Rules</Text>
                </TouchableOpacity>
              </View>

              {/* Speaking Leaderboard */}
              <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>
                  Monthly Active Speaking Leaderboard ({speakingLeaderboard.length})
                </Text>
                {speakingLeaderboard.slice(0, 20).map(({ user, stats, summary }) => (
                  <TouchableOpacity
                    key={user.uid}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingVertical: 6,
                      borderBottomWidth: 1,
                      borderBottomColor: c.border,
                    }}
                    onPress={async () => {
                      const items = await fetchUserSpeakingHistory(user.uid);
                      setInspectedUserHistory({ name: user.displayName, items });
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontWeight: '700', fontSize: 13 }}>{user.displayName}</Text>
                      <Text style={{ color: c.muted, fontSize: 11 }}>
                        This month: {formatSpeakingDuration(summary.activeSeconds)} · Lifetime:{' '}
                        {formatSpeakingDuration(stats?.lifetimeSeconds || 0)}
                      </Text>
                    </View>
                    <LevelBadge stats={stats} config={levelConfig} compact />
                  </TouchableOpacity>
                ))}
              </View>

              {inspectedUserHistory && (
                <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.marigold, gap: 6 }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>
                      Past Monthly History: {inspectedUserHistory.name}
                    </Text>
                    <TouchableOpacity onPress={() => setInspectedUserHistory(null)}>
                      <Text style={{ color: c.muted, fontWeight: '700', fontSize: 12 }}>Close</Text>
                    </TouchableOpacity>
                  </View>
                  {inspectedUserHistory.items.length === 0 ? (
                    <Text style={{ color: c.muted, fontSize: 12 }}>No archived past months yet.</Text>
                  ) : (
                    inspectedUserHistory.items.map((h) => (
                      <Text key={h.monthKey} style={{ color: c.text, fontSize: 12 }}>
                        {h.monthKey}: {h.wasVip ? '👑 VIP' : `Lv.${h.achievedLevel} ${h.levelName}`} ·{' '}
                        {formatSpeakingDuration(h.speakingSeconds)}
                      </Text>
                    ))
                  )}
                </View>
              )}
            </View>
          )}

          {section === 'economy' && isOriginalOwner && (
            <OwnerCoinEconomyPanel
              currentUser={currentUser}
              users={users}
              gifts={gifts}
              packages={packages}
              wallets={wallets}
              transactions={transactions}
              topups={topups}
              darkMode={darkMode}
              onRefreshParent={loadAll}
              onAudit={audit}
              onToast={onToast}
            />
          )}

          {section === 'content' && (
            <View style={{ gap: 10 }}>
              <Text style={{ color: c.text, fontWeight: '800' }}>Reports ({reports.length})</Text>
              {reports.map((rp) => (
                <View key={rp.id} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 4 }]}>
                  <Text style={{ color: c.text, fontWeight: '700', fontSize: 13 }}>
                    {rp.targetType.toUpperCase()}: {rp.reason} ({rp.status}) · by @{rp.reporterUsername}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity onPress={async () => { await adminUpdateReport(rp.id, 'resolved'); void loadAll(); }}>
                      <Text style={{ color: c.teal, fontWeight: '700', fontSize: 12 }}>Resolve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={async () => { await adminUpdateReport(rp.id, 'dismissed'); void loadAll(); }}>
                      <Text style={{ color: c.muted, fontWeight: '700', fontSize: 12 }}>Dismiss</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              <Text style={{ color: c.text, fontWeight: '800', marginTop: 6 }}>Live Video ({liveStreams.length})</Text>
              {liveStreams.map((ls) => (
                <View
                  key={ls.id}
                  style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
                >
                  <Text style={{ color: c.text, fontWeight: '700' }}>{ls.title}</Text>
                  <TouchableOpacity onPress={() => endLiveStream(ls.id)}>
                    <Text style={{ color: c.danger, fontWeight: '800', fontSize: 12 }}>Force End</Text>
                  </TouchableOpacity>
                </View>
              ))}

              <Text style={{ color: c.text, fontWeight: '800', marginTop: 6 }}>Posts ({posts.length})</Text>
              {posts.slice(0, 20).map((p) => (
                <View key={p.id} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 6 }]}>
                  <Text style={{ color: c.text, fontSize: 12 }} numberOfLines={2}>
                    @{p.authorUsername}: {p.caption}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <TouchableOpacity
                      onPress={async () => {
                        await adminSetPostStatus(p.id, p.status === 'hidden' ? 'active' : 'hidden');
                        void loadAll();
                      }}
                    >
                      <Text style={{ color: c.marigold, fontSize: 12, fontWeight: '700' }}>
                        {p.status === 'hidden' ? 'Restore' : 'Hide'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() =>
                        Alert.alert('Delete Post', 'Permanently delete?', [
                          { text: 'Cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: async () => {
                              await adminDeletePost(p.id);
                              void loadAll();
                            },
                          },
                        ])
                      }
                    >
                      <Text style={{ color: c.danger, fontSize: 12, fontWeight: '700' }}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              <Text style={{ color: c.text, fontWeight: '800', marginTop: 6 }}>Support Tickets ({tickets.length})</Text>
              {tickets.map((tk) => (
                <View key={tk.id} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 6 }]}>
                  <Text style={{ color: c.text, fontWeight: '700', fontSize: 12 }}>
                    @{tk.username}: {tk.subject} ({tk.status})
                  </Text>
                  <TouchableOpacity
                    onPress={async () => {
                      await adminReplySupportTicket(tk.id, 'resolved', 'Resolved by BANDHU MELA Owner Support.');
                      void loadAll();
                    }}
                  >
                    <Text style={{ color: c.teal, fontSize: 12, fontWeight: '700' }}>Mark Resolved</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {section === 'settings' && isOriginalOwner && (
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 12 }]}>
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>Platform Feature Controls</Text>
              <TextInput
                placeholder="Welcome Headline"
                placeholderTextColor={c.muted}
                value={settingsDraft.welcomeHeadline}
                onChangeText={(val) => setSettingsDraft((prev) => ({ ...prev, welcomeHeadline: val }))}
                style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
              {(
                [
                  ['allowNewRegistrations', 'Allow New Registrations'],
                  ['allowAudioRooms', 'Enable Audio Party Rooms'],
                  ['allowVirtualGifts', 'Enable Virtual Gifts'],
                  ['allowCoinPurchases', 'Enable Coin Purchases'],
                  ['allowLiveStreaming', 'Enable Live Video'],
                  ['allowVideoReels', 'Enable Video Reels'],
                  ['maintenanceMode', 'Maintenance Mode'],
                ] as const
              ).map(([key, label]) => (
                <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: c.text, fontSize: 13 }}>{label}</Text>
                  <Switch
                    value={Boolean(settingsDraft[key])}
                    onValueChange={(val) => setSettingsDraft((prev) => ({ ...prev, [key]: val }))}
                  />
                </View>
              ))}
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: c.teal }]}
                onPress={async () => {
                  await saveAppSettings(currentUser.uid, settingsDraft, currentUser.uid);
                  await audit('save_platform_settings', 'appSettings', 'platform', settingsDraft.welcomeHeadline);
                  onToast('Platform settings saved!');
                }}
              >
                <Text style={{ color: '#FFF', fontWeight: '800' }}>Save Owner Settings</Text>
              </TouchableOpacity>
            </View>
          )}

          {section === 'audit' && isOriginalOwner && (
            <View style={{ gap: 10 }}>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: c.teal }]}
                onPress={async () => {
                  const json = await exportFullPlatformBackupJson();
                  await Share.share({ message: json, title: 'BANDHU MELA Full Backup' });
                }}
              >
                <Text style={{ color: '#FFF', fontWeight: '800' }}>Export Full Database Backup (JSON)</Text>
              </TouchableOpacity>

              <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>
                  Immutable Admin Audit Log ({auditLogs.length})
                </Text>
                {auditLogs.map((log) => (
                  <View key={log.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border }}>
                    <Text style={{ color: c.text, fontWeight: '700', fontSize: 12 }}>
                      [{log.actorRole.toUpperCase()}] {log.actorName} · {log.action} · {formatRelativeTime(log.createdAt)}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 11 }}>{log.details}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  topBar: {
    height: 58,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tabPill: { height: 34, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, justifyContent: 'center' },
  statBox: { width: '48%', borderRadius: 16, borderWidth: 1, padding: 12 },
  card: { borderRadius: 18, borderWidth: 1, padding: 14 },
  smallBtn: { height: 34, paddingHorizontal: 12, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  btn: { height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  input: { height: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 13 },
});
