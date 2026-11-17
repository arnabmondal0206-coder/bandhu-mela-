import React, { useEffect, useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { signOut } from 'firebase/auth';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { AvatarFrame, VerifiedBadge } from '../components/BandhuLogo';
import { LevelBadge, LevelProgressCard } from '../components/LevelBadge';
import { auth } from '../config/firebase';
import { PALETTE, t } from '../i18n/translations';
import {
  compressAndUploadMedia,
  computeLevelSummary,
  resolveMediaUrl,
  subscribeSpeakingHistory,
  updateUserProfile,
} from '../services/api';
import {
  LanguageCode,
  LevelConfig,
  Post,
  SpeakingMonthHistory,
  SpeakingStats,
  UserProfile,
  UserWallet,
} from '../types/social';

interface ProfileScreenProps {
  currentUser: UserProfile;
  wallet: UserWallet | null;
  posts: Post[];
  savedIds: Set<string>;
  levelConfig: LevelConfig;
  speakingStats: SpeakingStats | null;
  isAdmin: boolean;
  isOriginalOwner: boolean;
  verifiedOwnerUid?: string | null;
  ownerBackendVerified?: boolean;
  darkMode: boolean;
  lang: LanguageCode;
  onToggleTheme: () => void;
  onToggleLang: () => void;
  onProfileUpdated: (next: UserProfile) => void;
  onNavigate: (route: string) => void;
  onToast: (msg: string) => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  currentUser,
  wallet,
  posts,
  savedIds,
  levelConfig,
  speakingStats,
  isAdmin,
  isOriginalOwner,
  verifiedOwnerUid = null,
  ownerBackendVerified = false,
  darkMode,
  lang,
  onToggleTheme,
  onToggleLang,
  onProfileUpdated,
  onNavigate,
  onToast,
}) => {
  const isVerifiedOriginalOwner = Boolean(
    isOriginalOwner && (!verifiedOwnerUid || verifiedOwnerUid === currentUser.uid)
  );
  const c = darkMode ? PALETTE.dark : PALETTE.light;
  const [tab, setTab] = useState<'posts' | 'saved'>('posts');
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState(currentUser.displayName);
  const [bio, setBio] = useState(currentUser.bio);
  const [location, setLocation] = useState(currentUser.location || '');
  const [workOrBioTag, setWorkOrBioTag] = useState(currentUser.workOrBioTag || '');
  const [history, setHistory] = useState<SpeakingMonthHistory[]>([]);
  const [uploadingField, setUploadingField] = useState<'photoURL' | 'coverURL' | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeSpeakingHistory(currentUser.uid, setHistory);
  }, [currentUser.uid]);

  const lvlSummary = computeLevelSummary(speakingStats, levelConfig);
  const showVipFrame = lvlSummary.isVip && levelConfig.enableVipFrames;
  const showVipColor = lvlSummary.isVip && levelConfig.enableVipNameColors;

  const myPosts = posts.filter((p) => p.authorId === currentUser.uid);
  const savedPosts = posts.filter((p) => savedIds.has(p.id));
  const shown = tab === 'posts' ? myPosts : savedPosts;

  const uploadPhoto = async (field: 'photoURL' | 'coverURL') => {
    if (uploadingField) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (res.canceled || !res.assets[0]) return;
    setUploadError(null);
    setUploadingField(field);
    setUploadProgress(4);
    setUploadStage(field === 'photoURL' ? 'Preparing profile photo...' : 'Preparing cover photo...');
    try {
      const folder = field === 'photoURL' ? 'avatars' : 'covers';
      const url = await compressAndUploadMedia(res.assets[0].uri, folder, 'image', (pct, stage) => {
        setUploadProgress(pct);
        setUploadStage(stage);
      });
      await updateUserProfile(currentUser.uid, { [field]: url });
      onProfileUpdated({ ...currentUser, [field]: url });
      onToast(field === 'photoURL' ? 'Profile photo updated!' : 'Cover photo updated!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setUploadError(msg);
      onToast(msg);
    } finally {
      setUploadingField(null);
      setUploadProgress(0);
      setUploadStage('');
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      {/* Cover */}
      <TouchableOpacity
        style={[styles.cover, { backgroundColor: c.teal }]}
        disabled={Boolean(uploadingField)}
        onPress={() => uploadPhoto('coverURL')}
      >
        {!!currentUser.coverURL && (
          <Image source={{ uri: resolveMediaUrl(currentUser.coverURL) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        )}
        <View style={styles.coverBadge}>
          <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700' }}>
            {uploadingField === 'coverURL' ? `Uploading cover ${uploadProgress}%...` : 'Tap to change cover'}
          </Text>
        </View>
      </TouchableOpacity>

      <View style={{ padding: 14, gap: 12 }}>
        {/* Upload Progress / Error Banner */}
        {(uploadingField || uploadError) && (
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: uploadError ? c.danger : c.teal, marginTop: -24, marginBottom: 4 }]}>
            {uploadingField ? (
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }}>{uploadStage || 'Uploading...'}</Text>
                  <Text style={{ color: c.teal, fontSize: 12, fontWeight: '800' }}>{uploadProgress}%</Text>
                </View>
                <View style={{ height: 6, borderRadius: 4, backgroundColor: c.bg, overflow: 'hidden' }}>
                  <View style={{ width: `${Math.max(5, uploadProgress)}%`, height: '100%', backgroundColor: c.teal }} />
                </View>
              </View>
            ) : (
              <Text style={{ color: c.danger, fontSize: 12, fontWeight: '600' }}>{uploadError}</Text>
            )}
          </View>
        )}

        {/* Avatar + Name */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: showVipFrame ? '#F59E0B' : c.border, marginTop: uploadingField || uploadError ? 0 : -36 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <TouchableOpacity onPress={() => uploadPhoto('photoURL')}>
              <AvatarFrame
                uri={currentUser.photoURL}
                name={currentUser.displayName}
                size={64}
                isVip={showVipFrame}
                vipColor={levelConfig.vipBadgeColor || '#F59E0B'}
              />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 }}>
                <Text style={{ color: showVipColor ? '#D97706' : c.text, fontSize: 18, fontWeight: '800' }}>
                  {currentUser.displayName}
                </Text>
                {currentUser.isVerified && <VerifiedBadge size={16} />}
                <LevelBadge stats={speakingStats} config={levelConfig} compact />
              </View>
              <Text style={{ color: c.muted, fontSize: 12 }}>@{currentUser.username}</Text>
              {!!currentUser.location && <Text style={{ color: c.teal, fontSize: 11 }}>{currentUser.location}</Text>}
            </View>
            <TouchableOpacity
              style={{ height: 36, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border, justifyContent: 'center' }}
              onPress={() => setEditOpen(true)}
            >
              <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }}>Edit</Text>
            </TouchableOpacity>
          </View>

          <Text style={{ color: c.text, fontSize: 13, marginTop: 10 }}>{currentUser.bio}</Text>

          <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.border }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>{myPosts.length}</Text>
              <Text style={{ color: c.muted, fontSize: 11 }}>Posts</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>{currentUser.followersCount}</Text>
              <Text style={{ color: c.muted, fontSize: 11 }}>Followers</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>{currentUser.followingCount}</Text>
              <Text style={{ color: c.muted, fontSize: 11 }}>Following</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: c.marigold, fontWeight: '800', fontSize: 15 }}>{wallet?.coinsBalance ?? 0}</Text>
              <Text style={{ color: c.muted, fontSize: 11 }}>Coins</Text>
            </View>
          </View>
        </View>

        {/* Monthly Speaking Level & VIP Progress Card */}
        <LevelProgressCard stats={speakingStats} config={levelConfig} history={history} darkMode={darkMode} />

        {/* Quick Navigation Menu */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
          {(isVerifiedOriginalOwner || isAdmin) && (
            <TouchableOpacity
              style={[styles.menuBtn, { backgroundColor: isVerifiedOriginalOwner ? '#F59E0B' : '#E5E7EB' }]}
              onPress={() => onNavigate('OwnerAdmin')}
            >
              <Ionicons name="shield-checkmark" size={18} color="#14171A" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#14171A', fontWeight: '900', fontSize: 14 }}>
                  {isVerifiedOriginalOwner ? 'SUPER ADMIN OWNER DASHBOARD' : 'Admin Moderation Panel'}
                </Text>
                {isVerifiedOriginalOwner && (
                  <Text style={{ color: '#451A03', fontSize: 10, fontWeight: '700' }}>
                    {ownerBackendVerified ? 'Verified Owner UID · Backend Locked' : 'Verified Owner Registry'}
                  </Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color="#14171A" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.menuBtn, { backgroundColor: c.bg }]} onPress={() => onNavigate('AudioParty')}>
            <Ionicons name="mic-outline" size={18} color={c.teal} />
            <Text style={{ color: c.text, fontWeight: '700', flex: 1 }}>{t(lang, 'audioParty')}</Text>
            <Ionicons name="chevron-forward" size={18} color={c.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.menuBtn, { backgroundColor: c.bg }]} onPress={() => onNavigate('Wallet')}>
            <Ionicons name="wallet-outline" size={18} color={c.marigold} />
            <Text style={{ color: c.text, fontWeight: '700', flex: 1 }}>{t(lang, 'wallet')}</Text>
            <Ionicons name="chevron-forward" size={18} color={c.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.menuBtn, { backgroundColor: c.bg }]} onPress={() => onNavigate('CommunitiesEvents')}>
            <Ionicons name="compass-outline" size={18} color={c.teal} />
            <Text style={{ color: c.text, fontWeight: '700', flex: 1 }}>{t(lang, 'communities')}</Text>
            <Ionicons name="chevron-forward" size={18} color={c.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.menuBtn, { backgroundColor: c.bg }]} onPress={() => onNavigate('PrivacySupport')}>
            <Ionicons name="lock-closed-outline" size={18} color={c.text} />
            <Text style={{ color: c.text, fontWeight: '700', flex: 1 }}>{t(lang, 'privacy')}</Text>
            <Ionicons name="chevron-forward" size={18} color={c.muted} />
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <TouchableOpacity style={[styles.menuBtn, { flex: 1, backgroundColor: c.bg, justifyContent: 'center' }]} onPress={onToggleTheme}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 12 }}>{darkMode ? 'Light Mode' : 'Dark Mode'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuBtn, { flex: 1, backgroundColor: c.bg, justifyContent: 'center' }]} onPress={onToggleLang}>
              <Text style={{ color: c.teal, fontWeight: '700', fontSize: 12 }}>{lang === 'en' ? 'বাংলা' : 'English'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuBtn, { flex: 1, backgroundColor: c.bg, justifyContent: 'center' }]}
              onPress={() => signOut(auth)}
            >
              <Text style={{ color: c.danger, fontWeight: '700', fontSize: 12 }}>{t(lang, 'signOut')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Posts vs Saved */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['posts', 'saved'] as const).map((tb) => (
            <TouchableOpacity
              key={tb}
              style={[styles.tabBtn, { backgroundColor: tab === tb ? c.teal : c.surface, borderColor: c.border }]}
              onPress={() => setTab(tb)}
            >
              <Text style={{ color: tab === tb ? '#FFF' : c.text, fontWeight: '700', fontSize: 12 }}>
                {tb === 'posts' ? `My Posts (${myPosts.length})` : `Saved (${savedPosts.length})`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {shown.map((p) => (
          <View key={p.id} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={{ color: c.text, fontSize: 13 }}>{p.caption}</Text>
            {!!p.mediaUrl && p.mediaType === 'image' && (
              <Image source={{ uri: resolveMediaUrl(p.mediaUrl) }} style={{ width: '100%', height: 180, borderRadius: 12, marginTop: 8 }} />
            )}
          </View>
        ))}
      </View>

      <Modal visible={editOpen} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={{ color: c.text, fontSize: 16, fontWeight: '800' }}>Edit Profile</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Display Name"
              placeholderTextColor={c.muted}
              style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="City / Location"
              placeholderTextColor={c.muted}
              style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
            <TextInput
              value={workOrBioTag}
              onChangeText={setWorkOrBioTag}
              placeholder="Tagline / Profession (e.g. Musician, Student)"
              placeholderTextColor={c.muted}
              style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
            <TextInput
              value={bio}
              onChangeText={setBio}
              placeholder="Bio"
              placeholderTextColor={c.muted}
              multiline
              style={[styles.input, { height: 80, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={[styles.tabBtn, { borderColor: c.border }]} onPress={() => setEditOpen(false)}>
                <Text style={{ color: c.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, { backgroundColor: c.teal, borderColor: c.teal }]}
                onPress={async () => {
                  await updateUserProfile(currentUser.uid, { displayName: name, bio, location, workOrBioTag });
                  onProfileUpdated({ ...currentUser, displayName: name, bio, location, workOrBioTag });
                  setEditOpen(false);
                  onToast('Profile saved!');
                }}
              >
                <Text style={{ color: '#FFF', fontWeight: '800' }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  cover: { height: 130, justifyContent: 'flex-end', alignItems: 'flex-end', padding: 10 },
  coverBadge: { backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  card: { borderRadius: 20, borderWidth: 1, padding: 14 },
  menuBtn: { height: 46, borderRadius: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  tabBtn: { flex: 1, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 18 },
  modalSheet: { borderRadius: 22, borderWidth: 1, padding: 18, gap: 10 },
  input: { height: 46, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, fontSize: 14 },
});
