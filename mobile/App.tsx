import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { Ionicons } from '@expo/vector-icons';
import { BandhuLogo } from './src/components/BandhuLogo';
import { auth } from './src/config/firebase';
import { PALETTE, t } from './src/i18n/translations';
import { AudioPartyScreen } from './src/screens/AudioPartyScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { CommunitiesEventsScreen } from './src/screens/CommunitiesEventsScreen';
import { FriendsScreen } from './src/screens/FriendsScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { LiveScreen } from './src/screens/LiveScreen';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { OwnerAdminScreen } from './src/screens/OwnerAdminScreen';
import { PrivacySupportScreen } from './src/screens/PrivacySupportScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { ReelsScreen } from './src/screens/ReelsScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import {
  checkIsAdminRecord,
  claimAndVerifyOriginalOwner,
  DEFAULT_APP_SETTINGS,
  DEFAULT_LEVEL_CONFIG,
  ensureUserProfile,
  ensureUserWallet,
  getCachedPosts,
  getCachedUsers,
  setUserPresence,
  subscribeActiveAnnouncements,
  subscribeActiveStories,
  subscribeAllPresence,
  subscribeAllSpeakingStatsMap,
  subscribeAllUsers,
  subscribeAppSettings,
  subscribeBlocks,
  subscribeConversations,
  subscribeFeedPosts,
  subscribeFriendRequests,
  subscribeLevelConfig,
  subscribeLiveStreams,
  subscribeMyFollowing,
  subscribeMyWallet,
  subscribeNotifications,
  subscribeSavedPostIds,
  syncOrResetMonthlyCycle,
} from './src/services/api';
import {
  Announcement,
  AppSettings,
  Conversation,
  FriendRequest,
  LanguageCode,
  LevelConfig,
  LiveStream,
  NotificationItem,
  Post,
  SpeakingStats,
  StoryItem,
  UserPresence,
  UserProfile,
  UserWallet,
} from './src/types/social';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOriginalOwner, setIsOriginalOwner] = useState(false);
  const [verifiedOwnerUid, setVerifiedOwnerUid] = useState<string | null>(null);
  const [ownerBackendVerified, setOwnerBackendVerified] = useState(false);
  const [wallet, setWallet] = useState<UserWallet | null>(null);

  const [darkMode, setDarkMode] = useState(false);
  const [lang, setLang] = useState<LanguageCode>('en');
  const [feedLimit, setFeedLimit] = useState(25);

  const [posts, setPosts] = useState<Post[]>([]);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
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
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((prev) => (prev === msg ? null : prev)), 3000);
  };

  useEffect(() => {
    void AsyncStorage.getItem('bandhu_theme').then((v) => setDarkMode(v === 'dark'));
    void AsyncStorage.getItem('bandhu_lang').then((v) => setLang(v === 'bn' ? 'bn' : 'en'));
    void getCachedPosts().then((p) => p.length && setPosts(p));
    void getCachedUsers().then((u) => u.length && setAllUsers(u));
  }, []);

  const toggleTheme = () => {
    setDarkMode((prev) => {
      const next = !prev;
      void AsyncStorage.setItem('bandhu_theme', next ? 'dark' : 'light');
      return next;
    });
  };

  const toggleLang = () => {
    setLang((prev) => {
      const next: LanguageCode = prev === 'en' ? 'bn' : 'en';
      void AsyncStorage.setItem('bandhu_lang', next);
      return next;
    });
  };

  const hydrateUser = async (user: User) => {
    const raw = await AsyncStorage.getItem('bandhu_pending_signup');
    let overrides: { displayName?: string; username?: string; phoneNumber?: string } | undefined;
    if (raw) {
      overrides = JSON.parse(raw);
      await AsyncStorage.removeItem('bandhu_pending_signup');
    }
    const profile = await ensureUserProfile(user, overrides);
    setCurrentUser(profile);
    void ensureUserWallet(user.uid).catch(() => {});
    void syncOrResetMonthlyCycle(user.uid).catch(() => {});
    const ownerStatus = await claimAndVerifyOriginalOwner(user);
    setIsOriginalOwner(ownerStatus.isOriginalOwner);
    setVerifiedOwnerUid(ownerStatus.ownerUid);
    setOwnerBackendVerified(ownerStatus.backendVerified);
    const adminMatch = ownerStatus.isOriginalOwner ? true : await checkIsAdminRecord(user.uid);
    setIsAdmin(ownerStatus.isOriginalOwner || adminMatch);
  };

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      if (!user || !user.emailVerified) {
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
        await hydrateUser(user);
      } finally {
        setAuthReady(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    void setUserPresence(currentUser.uid, true);
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
      subscribeMyWallet(currentUser.uid, setWallet),
      subscribeLevelConfig(setLevelConfig),
      subscribeAllSpeakingStatsMap(setSpeakingStatsMap),
    ];
    return () => {
      void setUserPresence(currentUser.uid, false);
      unsubs.forEach((fn) => fn());
    };
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser) return;
    return subscribeFeedPosts(setPosts, feedLimit);
  }, [currentUser?.uid, feedLimit]);

  const blockedAll = useMemo(() => {
    const s = new Set<string>(blockedByMe);
    blockedMe.forEach((id) => s.add(id));
    return s;
  }, [blockedByMe, blockedMe]);

  const reels = useMemo(
    () => posts.filter((p) => p.mediaType === 'reel' && !blockedAll.has(p.authorId)),
    [posts, blockedAll]
  );

  const c = darkMode ? PALETTE.dark : PALETTE.light;

  if (!authReady) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: c.bg }]}>
        <BandhuLogo size={48} />
        <ActivityIndicator color={c.teal} style={{ marginTop: 12 }} />
      </SafeAreaView>
    );
  }

  if (!authUser || !authUser.emailVerified || !currentUser) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <StatusBar barStyle={darkMode ? 'light-content' : 'dark-content'} />
        <AuthScreen
          unverifiedUser={authUser && !authUser.emailVerified ? authUser : null}
          lang={lang}
          darkMode={darkMode}
          allowNewRegistrations={appSettings.allowNewRegistrations}
          onToggleLang={toggleLang}
          onToggleTheme={toggleTheme}
          onVerifiedRefresh={async () => {
            if (!auth.currentUser) return;
            await auth.currentUser.reload();
            if (auth.currentUser.emailVerified) {
              await hydrateUser(auth.currentUser);
            } else {
              showToast('Email not verified yet.');
            }
          }}
        />
      </SafeAreaView>
    );
  }

  if (currentUser.isSuspended && !isAdmin) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: c.bg, padding: 24 }]}>
        <BandhuLogo size={44} />
        <Text style={{ color: c.text, fontWeight: '800', fontSize: 18, marginTop: 12 }}>Account Suspended</Text>
        <TouchableOpacity
          style={{ marginTop: 16, paddingHorizontal: 20, height: 42, borderRadius: 12, backgroundColor: c.teal, justifyContent: 'center' }}
          onPress={() => signOut(auth)}
        >
          <Text style={{ color: '#FFF', fontWeight: '700' }}>{t(lang, 'signOut')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const unreadAlerts = notifications.filter((n) => !n.read).length;

  const MainTabs = ({ navigation }: { navigation: { navigate: (name: string, params?: Record<string, unknown>) => void } }) => (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          height: 62,
          paddingBottom: 7,
          paddingTop: 4,
        },
        tabBarActiveTintColor: c.teal,
        tabBarInactiveTintColor: c.muted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
        tabBarIcon: ({ focused, color, size }) => {
          const map: Record<string, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
            Home: ['home', 'home-outline'],
            Friends: ['people', 'people-outline'],
            Reels: ['film', 'film-outline'],
            Notifications: ['notifications', 'notifications-outline'],
            Profile: ['person', 'person-outline'],
          };
          const pair = map[route.name] || ['ellipse', 'ellipse-outline'];
          return <Ionicons name={focused ? pair[0] : pair[1]} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" options={{ tabBarLabel: t(lang, 'home') }}>
        {() => (
          <HomeScreen
            currentUser={currentUser}
            wallet={wallet}
            posts={posts}
            stories={stories}
            allUsers={allUsers}
            presenceMap={presenceMap}
            liveStreams={liveStreams}
            announcements={announcements}
            followingIds={followingIds}
            savedIds={savedIds}
            friendRequests={friendRequests}
            blockedIds={blockedAll}
            unreadNotifications={unreadAlerts}
            appSettings={appSettings}
            levelConfig={levelConfig}
            speakingStatsMap={speakingStatsMap}
            feedLimit={feedLimit}
            onLoadMore={() => setFeedLimit((n) => Math.min(120, n + 20))}
            lang={lang}
            darkMode={darkMode}
            onToggleTheme={toggleTheme}
            onToggleLang={toggleLang}
            onNavigate={(r, p) => navigation.navigate(r, p)}
            onToast={showToast}
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="Friends" options={{ tabBarLabel: t(lang, 'friends') }}>
        {() => (
          <FriendsScreen
            currentUser={currentUser}
            allUsers={allUsers}
            allPosts={posts}
            presenceMap={presenceMap}
            followingIds={followingIds}
            friendRequests={friendRequests}
            blockedIds={blockedAll}
            levelConfig={levelConfig}
            speakingStatsMap={speakingStatsMap}
            darkMode={darkMode}
            onNavigate={(r, p) => navigation.navigate(r, p)}
            onToast={showToast}
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="Reels" options={{ tabBarLabel: t(lang, 'reels') }}>
        {() => (
          <ReelsScreen
            reels={reels}
            currentUser={currentUser}
            followingIds={followingIds}
            savedIds={savedIds}
            darkMode={darkMode}
            onToast={showToast}
          />
        )}
      </Tab.Screen>
      <Tab.Screen
        name="Notifications"
        options={{
          tabBarLabel: t(lang, 'notifications'),
          tabBarBadge: unreadAlerts > 0 ? unreadAlerts : undefined,
        }}
      >
        {() => (
          <NotificationsScreen
            notifications={notifications}
            darkMode={darkMode}
            onNavigate={(r) => navigation.navigate(r)}
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="Profile" options={{ tabBarLabel: t(lang, 'profile') }}>
        {() => (
          <ProfileScreen
            currentUser={currentUser}
            wallet={wallet}
            posts={posts}
            savedIds={savedIds}
            levelConfig={levelConfig}
            speakingStats={speakingStatsMap[currentUser.uid] || null}
            isAdmin={isAdmin}
            isOriginalOwner={isOriginalOwner}
            verifiedOwnerUid={verifiedOwnerUid}
            ownerBackendVerified={ownerBackendVerified}
            darkMode={darkMode}
            lang={lang}
            onToggleTheme={toggleTheme}
            onToggleLang={toggleLang}
            onProfileUpdated={setCurrentUser}
            onNavigate={(r) => navigation.navigate(r)}
            onToast={showToast}
          />
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar barStyle={darkMode ? 'light-content' : 'dark-content'} />
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: c.surface },
            headerTintColor: c.text,
          }}
        >
          <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="AudioParty" options={{ title: t(lang, 'audioParty') }}>
            {({ navigation }) => (
              <AudioPartyScreen
                currentUser={currentUser}
                wallet={wallet}
                levelConfig={levelConfig}
                speakingStatsMap={speakingStatsMap}
                allowAudioRooms={appSettings.allowAudioRooms}
                allowVirtualGifts={appSettings.allowVirtualGifts}
                darkMode={darkMode}
                onOpenWallet={() => navigation.navigate('Wallet')}
                onToast={showToast}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="Wallet" options={{ title: t(lang, 'wallet') }}>
            {() => (
              <WalletScreen
                currentUser={currentUser}
                wallet={wallet}
                allowCoinPurchases={appSettings.allowCoinPurchases}
                darkMode={darkMode}
                onToast={showToast}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="Chat" options={{ title: t(lang, 'chat') }}>
            {({ route }) => (
              <ChatScreen
                currentUser={currentUser}
                allUsers={allUsers}
                presenceMap={presenceMap}
                conversations={conversations}
                blockedIds={blockedAll}
                initialPeerId={(route.params as { peerId?: string } | undefined)?.peerId || null}
                darkMode={darkMode}
                onToast={showToast}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="Live" options={{ title: t(lang, 'live') }}>
            {() => (
              <LiveScreen
                currentUser={currentUser}
                liveStreams={liveStreams.filter((l) => !blockedAll.has(l.hostId))}
                allowLiveStreaming={appSettings.allowLiveStreaming}
                darkMode={darkMode}
                onToast={showToast}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="CommunitiesEvents" options={{ title: t(lang, 'communities') }}>
            {() => <CommunitiesEventsScreen currentUser={currentUser} darkMode={darkMode} onToast={showToast} />}
          </Stack.Screen>
          <Stack.Screen name="PrivacySupport" options={{ title: t(lang, 'privacy') }}>
            {() => (
              <PrivacySupportScreen
                currentUser={currentUser}
                allUsers={allUsers}
                blockedByMe={blockedByMe}
                darkMode={darkMode}
                onProfileUpdated={setCurrentUser}
                onToast={showToast}
              />
            )}
          </Stack.Screen>
          {(isOriginalOwner || isAdmin) && (
            <Stack.Screen name="OwnerAdmin" options={{ title: isOriginalOwner ? 'Super Admin Owner Dashboard' : 'Admin Panel' }}>
              {() => (
                <OwnerAdminScreen
                  currentUser={currentUser}
                  isOriginalOwner={isOriginalOwner}
                  hasAdminAccess={isOriginalOwner || isAdmin}
                  ownerUid={verifiedOwnerUid}
                  ownerBackendVerified={ownerBackendVerified}
                  liveStreams={liveStreams}
                  appSettings={appSettings}
                  levelConfig={levelConfig}
                  speakingStatsMap={speakingStatsMap}
                  darkMode={darkMode}
                  onToast={showToast}
                />
              )}
            </Stack.Screen>
          )}
        </Stack.Navigator>
      </NavigationContainer>

      {toast && (
        <View style={styles.toast}>
          <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>{toast}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  toast: {
    position: 'absolute',
    bottom: 72,
    left: 16,
    right: 16,
    backgroundColor: '#14171A',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
});
