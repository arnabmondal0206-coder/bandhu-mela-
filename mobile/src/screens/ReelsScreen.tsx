import React, { useState } from 'react';
import { Dimensions, FlatList, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ResizeMode, Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { PALETTE } from '../i18n/translations';
import {
  compressAndUploadMedia,
  createPost,
  incrementPostShare,
  resolveMediaUrl,
  toggleFollowUser,
  toggleLikePost,
  toggleSavePost,
} from '../services/api';
import { Post, UserProfile } from '../types/social';

interface ReelsScreenProps {
  reels: Post[];
  currentUser: UserProfile;
  followingIds: Set<string>;
  savedIds: Set<string>;
  darkMode: boolean;
  onToast: (msg: string) => void;
}

const SCREEN_HEIGHT = Dimensions.get('window').height - 130;

export const ReelsScreen: React.FC<ReelsScreenProps> = ({
  reels,
  currentUser,
  followingIds,
  savedIds,
  darkMode,
  onToast,
}) => {
  const c = darkMode ? PALETTE.dark : PALETTE.light;
  const [muted, setMuted] = useState(false);
  const [uploadingReel, setUploadingReel] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState('');

  const handleUploadReel = async () => {
    if (uploadingReel) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 0.85,
    });
    if (res.canceled || !res.assets[0]) return;
    setUploadingReel(true);
    setUploadProgress(4);
    setUploadStage('Preparing Reel video...');
    try {
      const url = await compressAndUploadMedia(res.assets[0].uri, 'reels', 'video', (pct, stage) => {
        setUploadProgress(pct);
        setUploadStage(stage);
      });
      await createPost({ author: currentUser, caption: '#bandhumela #reel', mediaUrl: url, mediaType: 'reel', aspectRatio: '9:16' });
      onToast('Reel published!');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Reel upload failed');
    } finally {
      setUploadingReel(false);
      setUploadProgress(0);
      setUploadStage('');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={styles.topOverlay}>
        <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '800' }}>BANDHU MELA Reels</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity style={styles.topBtn} onPress={() => setMuted((m) => !m)}>
            <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={18} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.topBtn, { backgroundColor: c.teal, opacity: uploadingReel ? 0.7 : 1 }]}
            disabled={uploadingReel}
            onPress={handleUploadReel}
          >
            <Ionicons name="add" size={18} color="#FFF" />
            <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>
              {uploadingReel ? `${uploadProgress}%` : 'Upload'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {uploadingReel && (
        <View
          style={{
            position: 'absolute',
            top: 60,
            left: 14,
            right: 14,
            zIndex: 12,
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            padding: 10,
            borderRadius: 12,
            gap: 6,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '600' }} numberOfLines={1}>
              {uploadStage || 'Uploading Reel...'}
            </Text>
            <Text style={{ color: '#2DD4BF', fontSize: 12, fontWeight: '800' }}>{uploadProgress}%</Text>
          </View>
          <View style={{ height: 5, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' }}>
            <View style={{ width: `${Math.max(5, uploadProgress)}%`, height: '100%', backgroundColor: '#14B8A6' }} />
          </View>
        </View>
      )}

      <FlatList
        data={reels}
        pagingEnabled
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={{ height: SCREEN_HEIGHT, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <Text style={{ color: '#AAA', textAlign: 'center' }}>
              No short video reels yet. Tap Upload to post the first Reel!
            </Text>
          </View>
        }
        renderItem={({ item: reel }) => (
          <View style={{ height: SCREEN_HEIGHT, justifyContent: 'flex-end', backgroundColor: '#0A0C0E' }}>
            {!!reel.mediaUrl && (
              <Video
                source={{ uri: resolveMediaUrl(reel.mediaUrl) }}
                style={StyleSheet.absoluteFill}
                resizeMode={ResizeMode.COVER}
                isLooping
                shouldPlay
                isMuted={muted}
                useNativeControls
              />
            )}
            <View style={styles.bottomOverlay}>
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 15 }}>@{reel.authorUsername}</Text>
                  {reel.authorId !== currentUser.uid && (
                    <TouchableOpacity
                      style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: c.teal }}
                      onPress={() => toggleFollowUser(currentUser, reel.authorId, followingIds.has(reel.authorId))}
                    >
                      <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700' }}>
                        {followingIds.has(reel.authorId) ? 'Following' : 'Follow'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={{ color: '#EEE', fontSize: 13 }} numberOfLines={2}>
                  {reel.caption}
                </Text>
              </View>

              <View style={{ alignItems: 'center', gap: 16 }}>
                <TouchableOpacity onPress={() => toggleLikePost(reel, currentUser, false)} style={styles.railBtn}>
                  <Ionicons name="heart-outline" size={26} color="#FFF" />
                  <Text style={styles.railText}>{reel.likesCount}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    await incrementPostShare(reel.id);
                    await Share.share({ message: `Watch ${reel.authorName}'s Reel on BANDHU MELA` });
                  }}
                  style={styles.railBtn}
                >
                  <Ionicons name="share-social-outline" size={24} color="#FFF" />
                  <Text style={styles.railText}>{reel.sharesCount}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => toggleSavePost(currentUser.uid, reel.id, savedIds.has(reel.id))}
                  style={styles.railBtn}
                >
                  <Ionicons
                    name={savedIds.has(reel.id) ? 'bookmark' : 'bookmark-outline'}
                    size={24}
                    color={savedIds.has(reel.id) ? '#F59E0B' : '#FFF'}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  topOverlay: {
    position: 'absolute',
    top: 12,
    left: 14,
    right: 14,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  bottomOverlay: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  railBtn: { alignItems: 'center' },
  railText: { color: '#FFF', fontSize: 11, fontWeight: '700', marginTop: 2 },
});
