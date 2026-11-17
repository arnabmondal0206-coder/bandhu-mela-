import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { ResizeMode, Video } from 'expo-av';
import { AvatarFrame, BandhuLogo, VerifiedBadge } from '../components/BandhuLogo';
import { LevelBadge } from '../components/LevelBadge';
import { PALETTE, t } from '../i18n/translations';
import {
  addPostComment,
  checkIsPostLiked,
  compressAndUploadMedia,
  computeLevelSummary,
  createPost,
  createStory,
  deleteOwnPost,
  formatRelativeTime,
  getSuggestedFriends,
  incrementPostShare,
  rankTrendingPosts,
  resolveMediaUrl,
  sendFriendRequest,
  subscribePostComments,
  submitReport,
  toggleFollowUser,
  toggleLikePost,
  toggleSavePost,
} from '../services/api';
import {
  Announcement,
  AppSettings,
  FriendRequest,
  LanguageCode,
  LevelConfig,
  LiveStream,
  MediaType,
  Post,
  PostComment,
  SpeakingStats,
  StoryItem,
  UserPresence,
  UserProfile,
  UserWallet,
} from '../types/social';

interface HomeScreenProps {
  currentUser: UserProfile;
  wallet: UserWallet | null;
  posts: Post[];
  stories: StoryItem[];
  allUsers: UserProfile[];
  presenceMap: Record<string, UserPresence>;
  liveStreams: LiveStream[];
  announcements: Announcement[];
  followingIds: Set<string>;
  savedIds: Set<string>;
  friendRequests: FriendRequest[];
  blockedIds: Set<string>;
  unreadNotifications?: number;
  appSettings: AppSettings;
  levelConfig: LevelConfig;
  speakingStatsMap: Record<string, SpeakingStats>;
  feedLimit: number;
  onLoadMore: () => void;
  lang: LanguageCode;
  darkMode: boolean;
  onToggleTheme: () => void;
  onToggleLang: () => void;
  onNavigate: (route: string, params?: Record<string, unknown>) => void;
  onToast: (msg: string) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  currentUser,
  wallet,
  posts,
  stories,
  allUsers,
  presenceMap,
  liveStreams,
  announcements,
  followingIds,
  savedIds,
  friendRequests,
  blockedIds,
  unreadNotifications = 0,
  appSettings,
  levelConfig,
  speakingStatsMap,
  feedLimit,
  onLoadMore,
  lang,
  darkMode,
  onToggleTheme,
  onToggleLang,
  onNavigate,
  onToast,
}) => {
  const c = darkMode ? PALETTE.dark : PALETTE.light;
  const [feedMode, setFeedMode] = useState<'latest' | 'trending'>('latest');
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [composerOpen, setComposerOpen] = useState(false);
  const [caption, setCaption] = useState('');
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [pickedType, setPickedType] = useState<MediaType>('text');
  const [publishing, setPublishing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState('');
  const [composerError, setComposerError] = useState<string | null>(null);
  const [storyUploading, setStoryUploading] = useState(false);
  const [storyProgress, setStoryProgress] = useState(0);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [activeStory, setActiveStory] = useState<StoryItem | null>(null);
  const [commentPost, setCommentPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentInput, setCommentInput] = useState('');

  const heroFade = useRef(new Animated.Value(0)).current;
  const heroLift = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(heroFade, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.timing(heroLift, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start();
  }, [heroFade, heroLift]);

  useEffect(() => {
    void AsyncStorage.getItem('bandhu_onboarding_done').then((v) => {
      if (v === '1') setOnboardingDismissed(true);
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all(
      posts.slice(0, 30).map(async (p) => [p.id, await checkIsPostLiked(p.id, currentUser.uid)] as const)
    ).then((pairs) => {
      if (!mounted) return;
      const next: Record<string, boolean> = {};
      pairs.forEach(([id, val]) => {
        next[id] = val;
      });
      setLikedMap(next);
    });
    return () => {
      mounted = false;
    };
  }, [posts, currentUser.uid]);

  useEffect(() => {
    if (!commentPost) {
      setComments([]);
      return;
    }
    return subscribePostComments(commentPost.id, setComments);
  }, [commentPost?.id]);

  const verifiedSet = useMemo(() => {
    const s = new Set<string>();
    allUsers.forEach((u) => u.isVerified && s.add(u.uid));
    if (currentUser.isVerified) s.add(currentUser.uid);
    return s;
  }, [allUsers, currentUser]);

  const visiblePosts = useMemo(() => {
    const filtered = posts.filter((p) => !blockedIds.has(p.authorId));
    return feedMode === 'trending' ? rankTrendingPosts(filtered) : filtered;
  }, [posts, blockedIds, feedMode]);

  const onlineFriends = useMemo(
    () =>
      allUsers
        .filter(
          (u) =>
            u.uid !== currentUser.uid &&
            !blockedIds.has(u.uid) &&
            u.showOnlineStatus !== false &&
            Boolean(presenceMap[u.uid]?.isOnline)
        )
        .slice(0, 14),
    [allUsers, currentUser.uid, blockedIds, presenceMap]
  );

  const suggestedFriends = useMemo(
    () => getSuggestedFriends(currentUser, allUsers, followingIds, friendRequests, blockedIds).slice(0, 8),
    [currentUser, allUsers, followingIds, friendRequests, blockedIds]
  );

  const reelsCount = useMemo(
    () => posts.filter((p) => p.mediaType === 'reel' && !blockedIds.has(p.authorId)).length,
    [posts, blockedIds]
  );

  const myStats = speakingStatsMap[currentUser.uid] || null;
  const myLevel = computeLevelSummary(myStats, levelConfig);

  const pickMedia = async (kind: 'image' | 'video' | 'reel') => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === 'image' ? ImagePicker.MediaTypeOptions.Images : ImagePicker.MediaTypeOptions.Videos,
      quality: 0.85,
    });
    if (!res.canceled && res.assets[0]) {
      setPickedUri(res.assets[0].uri);
      setPickedType(kind);
    }
  };

  const handleAddStory = async () => {
    if (storyUploading) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (res.canceled || !res.assets[0]) return;
    setStoryUploading(true);
    setStoryProgress(4);
    try {
      const url = await compressAndUploadMedia(res.assets[0].uri, 'stories', 'image', (pct) => {
        setStoryProgress(pct);
      });
      await createStory({ author: currentUser, mediaUrl: url, mediaType: 'image' });
      onToast('24h Story added!');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Story upload failed');
    } finally {
      setStoryUploading(false);
      setStoryProgress(0);
    }
  };

  const handlePublishPost = async () => {
    if (!caption.trim() && !pickedUri) return;
    setComposerError(null);
    setPublishing(true);
    setUploadProgress(pickedUri ? 4 : 0);
    setUploadStage(pickedUri ? 'Preparing media...' : 'Publishing...');
    try {
      let mediaUrl = '';
      if (pickedUri && pickedType !== 'text') {
        mediaUrl = await compressAndUploadMedia(
          pickedUri,
          pickedType === 'reel' ? 'reels' : 'posts',
          pickedType === 'image' ? 'image' : 'video',
          (pct, stage) => {
            setUploadProgress(pct);
            setUploadStage(stage);
          }
        );
      }
      await createPost({
        author: currentUser,
        caption,
        mediaUrl,
        mediaType: pickedUri ? pickedType : 'text',
        aspectRatio: pickedType === 'reel' ? '9:16' : '4:3',
      });
      setCaption('');
      setPickedUri(null);
      setPickedType('text');
      setComposerOpen(false);
      onToast('Published to BANDHU MELA!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Publish failed';
      setComposerError(msg);
      onToast(msg);
    } finally {
      setPublishing(false);
      setUploadProgress(0);
      setUploadStage('');
    }
  };

  const firstName = (currentUser.displayName || 'Friend').split(' ')[0];

  const renderHeader = () => (
    <View style={{ gap: 12, paddingBottom: 8 }}>
      {announcements.slice(0, 1).map((ann) => (
        <View
          key={ann.id}
          style={[
            styles.card,
            { backgroundColor: c.surface, borderColor: ann.priority === 'important' ? c.marigold : c.border },
          ]}
        >
          <Text style={{ color: c.teal, fontSize: 11, fontWeight: '800' }}>{ann.title}</Text>
          <Text style={{ color: c.text, fontSize: 13, marginTop: 2 }}>{ann.message}</Text>
        </View>
      ))}

      {/* Welcome Header & Profile Shortcut */}
      <Animated.View
        style={[
          styles.heroCard,
          {
            backgroundColor: c.surface,
            borderColor: c.border,
            opacity: heroFade,
            transform: [{ translateY: heroLift }],
          },
        ]}
      >
        <View style={styles.gradientStripeRow}>
          <View style={[styles.gradientStripeSegment, { backgroundColor: '#7C3AED' }]} />
          <View style={[styles.gradientStripeSegment, { backgroundColor: '#EC4899' }]} />
          <View style={[styles.gradientStripeSegment, { backgroundColor: '#F97316' }]} />
        </View>

        <View style={{ padding: 14, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.teal, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>
                {lang === 'bn' ? 'স্বাগতম বন্ধু মেলায়' : 'BANDHU MELA COURTYARD'}
              </Text>
              <Text style={{ color: c.text, fontSize: 20, fontWeight: '900', marginTop: 2 }} numberOfLines={1}>
                {lang === 'bn' ? `নমস্কার, ${firstName}` : `Welcome back, ${firstName}`}
              </Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {appSettings.welcomeHeadline || t(lang, 'tagline')}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => onNavigate('Profile')}
              style={[styles.profileShortcut, { backgroundColor: c.bg, borderColor: c.border }]}
              activeOpacity={0.85}
            >
              <AvatarFrame
                uri={currentUser.photoURL}
                name={currentUser.displayName}
                size={40}
                isVip={myLevel.isVip && levelConfig.enableVipFrames}
                vipColor={levelConfig.vipBadgeColor || '#F97316'}
                isOnline
              />
              <Ionicons name="chevron-forward" size={16} color={c.muted} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <LevelBadge stats={myStats} config={levelConfig} />
            <Text style={{ color: c.muted, fontSize: 11, fontWeight: '600' }}>
              {onlineFriends.length} online · {liveStreams.length} live
            </Text>
          </View>

          {/* Feature Shortcuts Row */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <TouchableOpacity
              onPress={() => onNavigate('AudioParty')}
              style={[styles.shortcutCard, { backgroundColor: darkMode ? '#1F1835' : '#F3EDFF', borderColor: c.teal }]}
            >
              <Ionicons name="mic" size={16} color={c.teal} />
              <Text style={{ color: c.text, fontSize: 12, fontWeight: '800' }}>{t(lang, 'audioParty')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => onNavigate('Reels')}
              style={[styles.shortcutCard, { backgroundColor: darkMode ? '#2B1524' : '#FCEEF5', borderColor: c.pink }]}
            >
              <Ionicons name="film" size={16} color={c.pink} />
              <Text style={{ color: c.text, fontSize: 12, fontWeight: '800' }}>
                {t(lang, 'reels')} ({reelsCount})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => onNavigate('Chat')}
              style={[styles.shortcutCard, { backgroundColor: darkMode ? '#181A2E' : '#EEF2FF', borderColor: c.border }]}
            >
              <Ionicons name="chatbubbles" size={16} color={c.teal} />
              <Text style={{ color: c.text, fontSize: 12, fontWeight: '800' }}>{t(lang, 'chat')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => onNavigate('Notifications')}
              style={[styles.shortcutCard, { backgroundColor: darkMode ? '#291B12' : '#FFF3EB', borderColor: c.marigold }]}
            >
              <Ionicons name="notifications" size={16} color={c.marigold} />
              <Text style={{ color: c.text, fontSize: 12, fontWeight: '800' }}>
                Alerts{unreadNotifications > 0 ? ` (${unreadNotifications})` : ''}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => onNavigate('Live')}
              style={[styles.shortcutCard, { backgroundColor: c.bg, borderColor: c.border }]}
            >
              <Ionicons name="radio" size={16} color={c.danger} />
              <Text style={{ color: c.text, fontSize: 12, fontWeight: '800' }}>{t(lang, 'live')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Animated.View>

      {/* Online Friends Indicator Strip */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: '#10B981' }} />
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 13 }}>
              {lang === 'bn' ? 'অনলাইন বন্ধু' : 'Online Friends'} ({onlineFriends.length})
            </Text>
          </View>
          <TouchableOpacity onPress={() => onNavigate('Friends')}>
            <Text style={{ color: c.teal, fontSize: 12, fontWeight: '700' }}>Directory</Text>
          </TouchableOpacity>
        </View>

        {onlineFriends.length === 0 ? (
          <TouchableOpacity
            onPress={() => onNavigate('Friends')}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 14,
              backgroundColor: c.bg,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ color: c.muted, fontSize: 12, flex: 1 }}>
              Discover friends and active Audio Party speakers now.
            </Text>
            <Text style={{ color: c.teal, fontSize: 12, fontWeight: '800', marginLeft: 8 }}>Explore</Text>
          </TouchableOpacity>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {onlineFriends.map((friend) => (
              <TouchableOpacity
                key={friend.uid}
                onPress={() => onNavigate('Chat', { peerId: friend.uid })}
                style={{ width: 64, alignItems: 'center', gap: 5 }}
              >
                <AvatarFrame
                  uri={friend.photoURL}
                  name={friend.displayName}
                  size={48}
                  isVip={
                    computeLevelSummary(speakingStatsMap[friend.uid], levelConfig).isVip &&
                    levelConfig.enableVipFrames
                  }
                  vipColor={levelConfig.vipBadgeColor || '#F97316'}
                  isOnline
                />
                <Text style={{ color: c.text, fontSize: 11, fontWeight: '600' }} numberOfLines={1}>
                  {friend.displayName.split(' ')[0]}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Stories & Live Strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        <TouchableOpacity
          style={[styles.storyBox, { backgroundColor: darkMode ? '#1F1835' : '#F3EDFF', borderColor: c.teal }]}
          disabled={storyUploading}
          onPress={handleAddStory}
        >
          {storyUploading ? (
            <>
              <ActivityIndicator color={c.teal} />
              <Text style={{ color: c.teal, fontSize: 11, fontWeight: '800', marginTop: 6 }}>
                {storyProgress}%
              </Text>
            </>
          ) : (
            <>
              <View style={[styles.storyPlusBadge, { backgroundColor: c.teal }]}>
                <Ionicons name="add" size={22} color="#FFF" />
              </View>
              <Text style={{ color: c.text, fontSize: 11, fontWeight: '800', marginTop: 8 }} numberOfLines={1}>
                Add Story
              </Text>
            </>
          )}
        </TouchableOpacity>

        {liveStreams.map((stream) => (
          <TouchableOpacity
            key={stream.id}
            style={[styles.storyBox, { backgroundColor: darkMode ? '#2B1524' : '#FCEEF5', borderColor: c.pink }]}
            onPress={() => onNavigate('Live')}
          >
            <Ionicons name="radio" size={24} color={c.pink} />
            <Text style={{ color: c.pink, fontSize: 10, fontWeight: '900', marginTop: 4 }}>LIVE</Text>
            <Text style={{ color: c.text, fontSize: 11, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>
              {stream.hostName}
            </Text>
          </TouchableOpacity>
        ))}

        {stories
          .filter((s) => !blockedIds.has(s.authorId))
          .map((story) => (
            <TouchableOpacity
              key={story.id}
              style={[styles.storyPhotoBox, { borderColor: c.marigold }]}
              onPress={() => setActiveStory(story)}
            >
              <Image source={{ uri: resolveMediaUrl(story.mediaUrl) }} style={styles.storyCoverImage} resizeMode="cover" />
              <View style={styles.storyLabelScrim}>
                <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '800' }} numberOfLines={1}>
                  {story.authorName}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
      </ScrollView>

      {/* Post Composer Card */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <AvatarFrame
            uri={currentUser.photoURL}
            name={currentUser.displayName}
            size={38}
            isVip={myLevel.isVip && levelConfig.enableVipFrames}
            isOnline
          />
          <TouchableOpacity
            style={[styles.composerInputBtn, { backgroundColor: c.bg, flex: 1 }]}
            onPress={() => setComposerOpen(true)}
          >
            <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>
              {t(lang, 'whatsOnMind')}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <TouchableOpacity
            style={[styles.actionChip, { backgroundColor: c.teal }]}
            onPress={() => setComposerOpen(true)}
          >
            <Ionicons name="image-outline" size={15} color="#FFF" />
            <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '800' }}>Post / Reel</Text>
          </TouchableOpacity>
          {appSettings.allowAudioRooms && (
            <TouchableOpacity
              style={[styles.actionChip, { backgroundColor: c.pink }]}
              onPress={() => onNavigate('AudioParty')}
            >
              <Ionicons name="mic-outline" size={15} color="#FFF" />
              <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '800' }}>{t(lang, 'audioParty')}</Text>
            </TouchableOpacity>
          )}
          {appSettings.allowLiveStreaming && (
            <TouchableOpacity
              style={[styles.actionChip, { borderColor: c.border, borderWidth: 1 }]}
              onPress={() => onNavigate('Live')}
            >
              <Ionicons name="videocam-outline" size={15} color={c.marigold} />
              <Text style={{ color: c.text, fontSize: 12, fontWeight: '800' }}>{t(lang, 'live')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {!onboardingDismissed && (currentUser.postsCount || 0) === 0 && followingIds.size === 0 && (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.teal }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>Get Started on BANDHU MELA</Text>
            <TouchableOpacity
              onPress={() => {
                setOnboardingDismissed(true);
                void AsyncStorage.setItem('bandhu_onboarding_done', '1');
              }}
            >
              <Ionicons name="close" size={18} color={c.muted} />
            </TouchableOpacity>
          </View>
          <Text style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>
            1. Add a photo · 2. Follow friends · 3. Join Audio Party to level up!
          </Text>
        </View>
      )}

      {/* Suggested Friends */}
      {suggestedFriends.length > 0 && (
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 13 }}>Suggested Friends</Text>
            <TouchableOpacity onPress={() => onNavigate('Friends')}>
              <Text style={{ color: c.teal, fontSize: 12, fontWeight: '700' }}>See All</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {suggestedFriends.map((person) => (
              <View
                key={person.uid}
                style={{
                  width: 152,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: c.border,
                  padding: 10,
                  backgroundColor: c.bg,
                  gap: 6,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <AvatarFrame
                    uri={person.photoURL}
                    name={person.displayName}
                    size={32}
                    isOnline={Boolean(presenceMap[person.uid]?.isOnline)}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>
                      {person.displayName}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 10 }} numberOfLines={1}>
                      @{person.username}
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                  <TouchableOpacity
                    style={{ flex: 1, height: 34, borderRadius: 10, backgroundColor: c.teal, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => toggleFollowUser(currentUser, person.uid, followingIds.has(person.uid))}
                  >
                    <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '800' }}>Follow</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}
                    onPress={async () => {
                      await sendFriendRequest(currentUser, person);
                      onToast(`Request sent to ${person.displayName}`);
                    }}
                  >
                    <Ionicons name="person-add-outline" size={14} color={c.teal} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Feed Switcher */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            style={[
              styles.chipBtn,
              {
                borderColor: feedMode === 'latest' ? c.teal : c.border,
                backgroundColor: feedMode === 'latest' ? c.teal : c.surface,
              },
            ]}
            onPress={() => setFeedMode('latest')}
          >
            <Text style={{ color: feedMode === 'latest' ? '#FFF' : c.text, fontSize: 12, fontWeight: '800' }}>
              Latest
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.chipBtn,
              {
                borderColor: feedMode === 'trending' ? c.pink : c.border,
                backgroundColor: feedMode === 'trending' ? c.pink : c.surface,
              },
            ]}
            onPress={() => setFeedMode('trending')}
          >
            <Text style={{ color: feedMode === 'trending' ? '#FFF' : c.text, fontSize: 12, fontWeight: '800' }}>
              Trending
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={{ color: c.muted, fontSize: 12 }}>{visiblePosts.length} posts</Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <BandhuLogo size={32} />
          <Text style={{ color: c.text, fontSize: 16, fontWeight: '900', letterSpacing: -0.3 }}>
            {t(lang, 'brand')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, height: 34, borderRadius: 10, backgroundColor: c.bg, borderWidth: 1, borderColor: c.border }}
            onPress={() => onNavigate('Wallet')}
          >
            <Ionicons name="wallet-outline" size={15} color={c.marigold} />
            <Text style={{ color: c.text, fontSize: 12, fontWeight: '800' }}>{wallet?.coinsBalance ?? 0}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onNavigate('AudioParty')}>
            <Ionicons name="mic-outline" size={22} color={c.teal} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onNavigate('Chat')}>
            <Ionicons name="chatbubble-ellipses-outline" size={21} color={c.pink} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onToggleTheme}>
            <Ionicons name={darkMode ? 'sunny-outline' : 'moon-outline'} size={20} color={c.marigold} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onToggleLang}>
            <Text style={{ color: c.teal, fontSize: 12, fontWeight: '800' }}>{lang === 'en' ? 'বাং' : 'EN'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={visiblePosts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 32 }}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, alignItems: 'center', padding: 28 }]}>
            <Text style={{ color: c.muted, textAlign: 'center' }}>{t(lang, 'noPosts')}</Text>
          </View>
        }
        ListFooterComponent={
          posts.length >= feedLimit ? (
            <TouchableOpacity
              style={[styles.outlineBtn, { borderColor: c.border, backgroundColor: c.surface }]}
              onPress={onLoadMore}
            >
              <Text style={{ color: c.teal, fontWeight: '800' }}>Load More Posts</Text>
            </TouchableOpacity>
          ) : null
        }
        renderItem={({ item: post }) => {
          const liked = Boolean(likedMap[post.id]);
          const saved = savedIds.has(post.id);
          const authorStats = speakingStatsMap[post.authorId] || null;
          const authorLvl = computeLevelSummary(authorStats, levelConfig);
          const showVipFrame = authorLvl.isVip && levelConfig.enableVipFrames;
          const showVipColor = authorLvl.isVip && levelConfig.enableVipNameColors;
          const isAuthorOnline = Boolean(presenceMap[post.authorId]?.isOnline);

          return (
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <AvatarFrame
                    uri={post.authorPhoto}
                    name={post.authorName}
                    size={42}
                    isVip={showVipFrame}
                    vipColor={levelConfig.vipBadgeColor || '#F97316'}
                    isOnline={isAuthorOnline}
                  />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                      <Text style={{ color: showVipColor ? '#F97316' : c.text, fontWeight: '800', fontSize: 14 }}>
                        {post.authorName}
                      </Text>
                      {verifiedSet.has(post.authorId) && <VerifiedBadge size={14} />}
                      <LevelBadge stats={authorStats} config={levelConfig} compact />
                    </View>
                    <Text style={{ color: c.muted, fontSize: 11 }}>
                      @{post.authorUsername} · {formatRelativeTime(post.createdAt)}
                    </Text>
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {post.authorId === currentUser.uid ? (
                    <TouchableOpacity
                      onPress={() =>
                        Alert.alert('Delete Post', 'Remove this post permanently?', [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Delete', style: 'destructive', onPress: () => deleteOwnPost(post, currentUser.uid) },
                        ])
                      }
                    >
                      <Ionicons name="trash-outline" size={18} color={c.danger} />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={async () => {
                        await submitReport({
                          reporter: currentUser,
                          targetType: 'post',
                          targetId: post.id,
                          targetOwnerId: post.authorId,
                          reason: 'Reported from mobile feed',
                        });
                        onToast('Reported to moderators.');
                      }}
                    >
                      <Ionicons name="flag-outline" size={18} color={c.muted} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {!!post.caption && (
                <Text style={{ color: c.text, fontSize: 14, lineHeight: 20, marginTop: 10 }}>{post.caption}</Text>
              )}

              {post.mediaType === 'image' && !!post.mediaUrl && (
                <Image source={{ uri: resolveMediaUrl(post.mediaUrl) }} style={styles.postMedia} resizeMode="cover" />
              )}

              {(post.mediaType === 'video' || post.mediaType === 'reel') && !!post.mediaUrl && (
                <Video
                  source={{ uri: resolveMediaUrl(post.mediaUrl) }}
                  style={styles.postMedia}
                  useNativeControls
                  resizeMode={ResizeMode.COVER}
                />
              )}

              <View style={[styles.postActions, { borderTopColor: c.border }]}>
                <TouchableOpacity
                  style={styles.postActionBtn}
                  onPress={async () => {
                    const next = await toggleLikePost(post, currentUser, liked);
                    setLikedMap((prev) => ({ ...prev, [post.id]: next }));
                  }}
                >
                  <Ionicons name={liked ? 'heart' : 'heart-outline'} size={20} color={liked ? c.pink : c.muted} />
                  <Text style={{ color: liked ? c.pink : c.text, fontSize: 12, fontWeight: '700' }}>{post.likesCount}</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.postActionBtn} onPress={() => setCommentPost(post)}>
                  <Ionicons name="chatbubble-outline" size={19} color={c.muted} />
                  <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }}>{post.commentsCount}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.postActionBtn}
                  onPress={async () => {
                    await incrementPostShare(post.id);
                    await Share.share({ message: `${post.authorName} on BANDHU MELA: ${post.caption}` });
                  }}
                >
                  <Ionicons name="share-social-outline" size={19} color={c.muted} />
                  <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }}>{post.sharesCount}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.postActionBtn}
                  onPress={() => toggleSavePost(currentUser.uid, post.id, saved)}
                >
                  <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={19} color={saved ? c.teal : c.muted} />
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />

      {/* Create Post Modal */}
      <Modal visible={composerOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: c.text, fontSize: 16, fontWeight: '800' }}>Create Post / Reel</Text>
              <TouchableOpacity onPress={() => setComposerOpen(false)}>
                <Ionicons name="close" size={22} color={c.muted} />
              </TouchableOpacity>
            </View>
            <TextInput
              placeholder="Write something, add #hashtags..."
              placeholderTextColor={c.muted}
              multiline
              value={caption}
              onChangeText={setCaption}
              style={[styles.textArea, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
            {pickedUri && (
              <Text style={{ color: c.teal, fontSize: 12, fontWeight: '600' }}>
                Selected {pickedType} ready to upload
              </Text>
            )}
            {publishing && pickedUri && (
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: c.muted, fontSize: 12 }} numberOfLines={1}>
                    {uploadStage || 'Uploading...'}
                  </Text>
                  <Text style={{ color: c.teal, fontSize: 12, fontWeight: '800' }}>{uploadProgress}%</Text>
                </View>
                <View style={{ height: 6, borderRadius: 4, backgroundColor: c.bg, overflow: 'hidden' }}>
                  <View style={{ width: `${Math.max(5, uploadProgress)}%`, height: '100%', backgroundColor: c.teal }} />
                </View>
              </View>
            )}
            {composerError && (
              <Text style={{ color: c.danger, fontSize: 12, fontWeight: '600' }}>{composerError}</Text>
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={[styles.chipBtn, { borderColor: c.border }]} onPress={() => pickMedia('image')}>
                <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }}>Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.chipBtn, { borderColor: c.border }]} onPress={() => pickMedia('video')}>
                <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }}>Video</Text>
              </TouchableOpacity>
              {appSettings.allowVideoReels && (
                <TouchableOpacity style={[styles.chipBtn, { borderColor: c.border }]} onPress={() => pickMedia('reel')}>
                  <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }}>Reel</Text>
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: c.teal, opacity: publishing ? 0.7 : 1 }]}
              onPress={handlePublishPost}
              disabled={publishing}
            >
              {publishing ? (
                <Text style={{ color: '#FFF', fontWeight: '800' }}>
                  {pickedUri ? `Uploading ${uploadProgress}%...` : 'Publishing...'}
                </Text>
              ) : (
                <Text style={{ color: '#FFF', fontWeight: '800' }}>Publish</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Story Viewer Modal */}
      <Modal visible={Boolean(activeStory)} transparent animationType="fade">
        <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.92)' }]}>
          {activeStory && (
            <View style={{ width: '90%', height: '76%', borderRadius: 24, overflow: 'hidden', backgroundColor: '#111' }}>
              <Image source={{ uri: resolveMediaUrl(activeStory.mediaUrl) }} style={{ flex: 1 }} resizeMode="contain" />
              <TouchableOpacity
                style={{ position: 'absolute', top: 16, right: 16, padding: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20 }}
                onPress={() => setActiveStory(null)}
              >
                <Ionicons name="close" size={22} color="#FFF" />
              </TouchableOpacity>
              <View style={{ padding: 14, backgroundColor: 'rgba(0,0,0,0.6)' }}>
                <Text style={{ color: '#FFF', fontWeight: '700' }}>{activeStory.authorName}</Text>
                {!!activeStory.caption && <Text style={{ color: '#DDD', fontSize: 12 }}>{activeStory.caption}</Text>}
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Comments Modal */}
      <Modal visible={Boolean(commentPost)} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: c.surface, maxHeight: '75%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: c.text, fontSize: 16, fontWeight: '800' }}>Comments</Text>
              <TouchableOpacity onPress={() => setCommentPost(null)}>
                <Ionicons name="close" size={22} color={c.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 280 }}>
              {comments.map((cm) => (
                <View key={cm.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border }}>
                  <Text style={{ color: c.text, fontWeight: '700', fontSize: 13 }}>{cm.authorName}</Text>
                  <Text style={{ color: c.text, fontSize: 13, marginTop: 2 }}>{cm.text}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                placeholder="Write a comment..."
                placeholderTextColor={c.muted}
                value={commentInput}
                onChangeText={setCommentInput}
                style={[styles.input, { flex: 1, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
              <TouchableOpacity
                style={{ width: 48, height: 46, borderRadius: 14, backgroundColor: c.teal, alignItems: 'center', justifyContent: 'center' }}
                onPress={async () => {
                  if (!commentPost || !commentInput.trim()) return;
                  await addPostComment(commentPost, currentUser, commentInput);
                  setCommentInput('');
                }}
              >
                <Ionicons name="send" size={18} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 58,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  card: { borderRadius: 22, borderWidth: 1, padding: 14 },
  heroCard: { borderRadius: 24, borderWidth: 1, overflow: 'hidden' },
  gradientStripeRow: { flexDirection: 'row', height: 4, width: '100%' },
  gradientStripeSegment: { flex: 1 },
  profileShortcut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 5,
    paddingRight: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  shortcutCard: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  storyBox: {
    width: 88,
    height: 132,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  storyPlusBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyPhotoBox: {
    width: 88,
    height: 132,
    borderRadius: 20,
    borderWidth: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  storyCoverImage: { width: '100%', height: '100%' },
  storyLabelScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingVertical: 5,
    backgroundColor: 'rgba(11, 11, 16, 0.58)',
  },
  composerInputBtn: { height: 44, borderRadius: 14, paddingHorizontal: 14, justifyContent: 'center' },
  actionChip: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipBtn: { paddingHorizontal: 14, height: 36, borderRadius: 12, borderWidth: 1, justifyContent: 'center' },
  postMedia: { width: '100%', height: 248, borderRadius: 16, marginTop: 10, backgroundColor: '#111' },
  postActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  postActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 48, height: 38 },
  outlineBtn: { height: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end', padding: 14 },
  modalSheet: { borderRadius: 24, borderWidth: 1, padding: 18, gap: 12 },
  textArea: { minHeight: 96, borderWidth: 1, borderRadius: 14, padding: 12, textAlignVertical: 'top', fontSize: 14 },
  input: { height: 46, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, fontSize: 14 },
  primaryBtn: { height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
