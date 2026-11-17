import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AvatarFrame, VerifiedBadge } from '../components/BandhuLogo';
import { LevelBadge } from '../components/LevelBadge';
import { PALETTE } from '../i18n/translations';
import {
  computeLevelSummary,
  formatRelativeTime,
  respondFriendRequest,
  sendFriendRequest,
  startCallSession,
  toggleFollowUser,
} from '../services/api';
import { FriendRequest, LevelConfig, Post, SpeakingStats, UserPresence, UserProfile } from '../types/social';

interface FriendsScreenProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  allPosts: Post[];
  presenceMap: Record<string, UserPresence>;
  followingIds: Set<string>;
  friendRequests: FriendRequest[];
  blockedIds: Set<string>;
  levelConfig: LevelConfig;
  speakingStatsMap: Record<string, SpeakingStats>;
  darkMode: boolean;
  onNavigate: (route: string, params?: Record<string, unknown>) => void;
  onToast: (msg: string) => void;
}

export const FriendsScreen: React.FC<FriendsScreenProps> = ({
  currentUser,
  allUsers,
  allPosts,
  presenceMap,
  followingIds,
  friendRequests,
  blockedIds,
  levelConfig,
  speakingStatsMap,
  darkMode,
  onNavigate,
  onToast,
}) => {
  const c = darkMode ? PALETTE.dark : PALETTE.light;
  const [queryText, setQueryText] = useState('');

  const pendingIncoming = useMemo(
    () => friendRequests.filter((r) => r.receiverId === currentUser.uid && r.status === 'pending'),
    [friendRequests, currentUser.uid]
  );

  const filteredUsers = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    return allUsers.filter((u) => {
      if (u.uid === currentUser.uid || u.isSuspended || blockedIds.has(u.uid)) return false;
      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        (u.location || '').toLowerCase().includes(q)
      );
    });
  }, [allUsers, currentUser.uid, blockedIds, queryText]);

  const matchedPosts = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    if (!q) return [];
    return allPosts
      .filter(
        (p) =>
          !blockedIds.has(p.authorId) &&
          (p.caption.toLowerCase().includes(q) || p.hashtags.some((h) => h.includes(q)))
      )
      .slice(0, 10);
  }, [allPosts, blockedIds, queryText]);

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      <View style={[styles.searchBox, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <View style={[styles.searchInputWrap, { backgroundColor: c.bg, borderColor: c.border }]}>
          <Ionicons name="search" size={18} color={c.muted} />
          <TextInput
            placeholder="Search people, posts, #hashtags, videos..."
            placeholderTextColor={c.muted}
            value={queryText}
            onChangeText={setQueryText}
            style={{ flex: 1, color: c.text, fontSize: 14 }}
          />
        </View>
      </View>

      <FlatList
        data={filteredUsers}
        keyExtractor={(u) => u.uid}
        contentContainerStyle={{ padding: 14, gap: 10 }}
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
            {pendingIncoming.length > 0 && (
              <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.teal }]}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 14, marginBottom: 8 }}>
                  Friend Requests ({pendingIncoming.length})
                </Text>
                {pendingIncoming.map((req) => (
                  <View key={req.id} style={styles.reqRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontWeight: '700' }}>{req.senderName}</Text>
                      <Text style={{ color: c.muted, fontSize: 12 }}>@{req.senderUsername}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.smallBtn, { backgroundColor: c.teal }]}
                      onPress={() => respondFriendRequest(req, currentUser, 'accepted')}
                    >
                      <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.smallBtn, { borderWidth: 1, borderColor: c.border }]}
                      onPress={() => respondFriendRequest(req, currentUser, 'declined')}
                    >
                      <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700' }}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {matchedPosts.length > 0 && (
              <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={{ color: c.teal, fontWeight: '800', fontSize: 13, marginBottom: 6 }}>
                  Matching Posts &amp; #Hashtags ({matchedPosts.length})
                </Text>
                {matchedPosts.map((p) => (
                  <Text key={p.id} style={{ color: c.text, fontSize: 12, marginBottom: 4 }} numberOfLines={2}>
                    @{p.authorUsername}: {p.caption}
                  </Text>
                ))}
              </View>
            )}

            <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>
              People on BANDHU MELA ({filteredUsers.length})
            </Text>
          </View>
        }
        renderItem={({ item: person }) => {
          const isFollowing = followingIds.has(person.uid);
          const pres = presenceMap[person.uid];
          const pStats = speakingStatsMap[person.uid] || null;
          const pLvl = computeLevelSummary(pStats, levelConfig);
          const showVipFrame = pLvl.isVip && levelConfig.enableVipFrames;
          const showVipColor = pLvl.isVip && levelConfig.enableVipNameColors;
          const existingReq = friendRequests.find(
            (r) =>
              (r.senderId === currentUser.uid && r.receiverId === person.uid) ||
              (r.receiverId === currentUser.uid && r.senderId === person.uid)
          );
          return (
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <AvatarFrame
                  uri={person.photoURL}
                  name={person.displayName}
                  size={40}
                  isVip={showVipFrame}
                  vipColor={levelConfig.vipBadgeColor || '#F59E0B'}
                />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 }}>
                    <Text style={{ color: showVipColor ? '#D97706' : c.text, fontWeight: '800', fontSize: 14 }}>
                      {person.displayName}
                    </Text>
                    {person.isVerified && <VerifiedBadge size={14} />}
                    <LevelBadge stats={pStats} config={levelConfig} compact />
                  </View>
                  <Text style={{ color: c.muted, fontSize: 12 }}>
                    @{person.username} ·{' '}
                    {pres?.isOnline
                      ? 'Online'
                      : pres?.lastSeen
                      ? `Last seen ${formatRelativeTime(pres.lastSeen)}`
                      : 'Offline'}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <TouchableOpacity
                    style={[
                      styles.smallBtn,
                      isFollowing ? { borderWidth: 1, borderColor: c.border } : { backgroundColor: c.teal },
                    ]}
                    onPress={() => toggleFollowUser(currentUser, person.uid, isFollowing)}
                  >
                    <Text style={{ color: isFollowing ? c.text : '#FFF', fontSize: 12, fontWeight: '700' }}>
                      {isFollowing ? 'Following' : 'Follow'}
                    </Text>
                  </TouchableOpacity>
                  {!existingReq && (
                    <TouchableOpacity
                      style={[styles.iconBtn, { borderColor: c.border }]}
                      onPress={async () => {
                        await sendFriendRequest(currentUser, person);
                        onToast(`Request sent to ${person.displayName}`);
                      }}
                    >
                      <Ionicons name="person-add-outline" size={16} color={c.teal} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.iconBtn, { borderColor: c.border }]}
                    onPress={() => onNavigate('Chat', { peerId: person.uid })}
                  >
                    <Ionicons name="chatbubble-outline" size={16} color={c.text} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.iconBtn, { borderColor: c.border }]}
                    onPress={async () => {
                      await startCallSession(currentUser, person, 'audio');
                      onToast(`Voice calling ${person.displayName}...`);
                    }}
                  >
                    <Ionicons name="call-outline" size={16} color={c.teal} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchBox: { padding: 12, borderBottomWidth: 1 },
  searchInputWrap: {
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  card: { borderRadius: 18, borderWidth: 1, padding: 14 },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  smallBtn: { height: 34, paddingHorizontal: 12, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  iconBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
});
