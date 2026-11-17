import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { PALETTE } from '../i18n/translations';
import {
  addLiveComment,
  endLiveStream,
  startLiveStream,
  subscribeLiveComments,
} from '../services/api';
import { LiveComment, LiveStream, UserProfile } from '../types/social';

interface LiveScreenProps {
  currentUser: UserProfile;
  liveStreams: LiveStream[];
  allowLiveStreaming: boolean;
  darkMode: boolean;
  onToast: (msg: string) => void;
}

export const LiveScreen: React.FC<LiveScreenProps> = ({
  currentUser,
  liveStreams,
  allowLiveStreaming,
  darkMode,
  onToast,
}) => {
  const c = darkMode ? PALETTE.dark : PALETTE.light;
  const [title, setTitle] = useState('');
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [commentText, setCommentText] = useState('');

  const activeStream = liveStreams.find((s) => s.id === activeStreamId) || null;

  useEffect(() => {
    if (!activeStreamId) {
      setComments([]);
      return;
    }
    return subscribeLiveComments(activeStreamId, setComments);
  }, [activeStreamId]);

  const handleGoLive = async () => {
    if (!allowLiveStreaming) {
      onToast('Live streaming is paused by the owner.');
      return;
    }
    await ImagePicker.requestCameraPermissionsAsync().catch(() => {});
    const stream = await startLiveStream(currentUser, title || `${currentUser.displayName} Live`);
    setTitle('');
    setActiveStreamId(stream.id);
  };

  if (activeStream) {
    const isHost = activeStream.hostId === currentUser.uid;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 14, gap: 12 }}>
        <View style={[styles.card, { backgroundColor: '#11181C', borderColor: c.danger, minHeight: 200, justifyContent: 'space-between' }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: '#EF4444', fontWeight: '900', fontSize: 12 }}>
              ● LIVE · {activeStream.viewersCount} viewers · {activeStream.reactionsCount} reactions
            </Text>
            <TouchableOpacity
              style={{ paddingHorizontal: 12, height: 34, borderRadius: 10, backgroundColor: c.danger, justifyContent: 'center' }}
              onPress={async () => {
                if (isHost) await endLiveStream(activeStream.id);
                setActiveStreamId(null);
              }}
            >
              <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '800' }}>
                {isHost ? 'End Broadcast' : 'Leave'}
              </Text>
            </TouchableOpacity>
          </View>
          <View>
            <Text style={{ color: '#FFF', fontSize: 18, fontWeight: '800' }}>{activeStream.title}</Text>
            <Text style={{ color: '#CBD5E1', fontSize: 12 }}>Host: {activeStream.hostName}</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {['👏', '🔥', '❤️', '🎉'].map((r) => (
              <TouchableOpacity
                key={r}
                style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, backgroundColor: c.bg }}
                onPress={() => addLiveComment(activeStream.id, currentUser, `sent ${r}`, 'reaction')}
              >
                <Text style={{ fontSize: 18 }}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {comments.slice(-15).map((cm) => (
            <Text key={cm.id} style={{ color: cm.kind === 'reaction' ? c.marigold : c.text, fontSize: 13 }}>
              <Text style={{ fontWeight: '800' }}>{cm.authorName}: </Text>
              {cm.text}
            </Text>
          ))}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              placeholder="Live comment..."
              placeholderTextColor={c.muted}
              value={commentText}
              onChangeText={setCommentText}
              style={[styles.input, { flex: 1, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
            <TouchableOpacity
              style={{ paddingHorizontal: 14, height: 46, borderRadius: 14, backgroundColor: c.teal, justifyContent: 'center' }}
              onPress={async () => {
                if (!commentText.trim()) return;
                await addLiveComment(activeStream.id, currentUser, commentText, 'comment');
                setCommentText('');
              }}
            >
              <Text style={{ color: '#FFF', fontWeight: '700' }}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 14, gap: 12 }}>
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 10 }]}>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '800' }}>Start Live Video Broadcast</Text>
        <TextInput
          placeholder="Broadcast Title..."
          placeholderTextColor={c.muted}
          value={title}
          onChangeText={setTitle}
          style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
        />
        <TouchableOpacity
          style={{ height: 44, borderRadius: 14, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' }}
          onPress={handleGoLive}
        >
          <Text style={{ color: '#FFF', fontWeight: '800' }}>Go Live Now</Text>
        </TouchableOpacity>
      </View>

      {liveStreams.map((stream) => (
        <TouchableOpacity
          key={stream.id}
          style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
          onPress={() => setActiveStreamId(stream.id)}
        >
          <Text style={{ color: c.danger, fontSize: 11, fontWeight: '800' }}>LIVE · {stream.viewersCount} viewers</Text>
          <Text style={{ color: c.text, fontSize: 15, fontWeight: '800', marginTop: 2 }}>{stream.title}</Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>Host: {stream.hostName}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 14 },
  input: { height: 46, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, fontSize: 14 },
});
