import React, { useEffect, useState } from 'react';
import { FlatList, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ResizeMode, Video } from 'expo-av';
import { PALETTE } from '../i18n/translations';
import {
  compressAndUploadMedia,
  createGroupConversation,
  formatRelativeTime,
  getOrCreateDirectConversation,
  resolveMediaUrl,
  sendChatMessage,
  startCallSession,
  subscribeMessages,
} from '../services/api';
import { ChatMessage, Conversation, UserPresence, UserProfile } from '../types/social';

interface ChatScreenProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  presenceMap: Record<string, UserPresence>;
  conversations: Conversation[];
  blockedIds: Set<string>;
  initialPeerId?: string | null;
  darkMode: boolean;
  onToast: (msg: string) => void;
}

function getConversationTitle(conv: Conversation, currentUid: string): string {
  if (conv.isGroup) return conv.groupName || 'Group Chat';
  if (conv.participantA === currentUid) return conv.participantBName || 'Direct Chat';
  return conv.participantAName || 'Direct Chat';
}

export const ChatScreen: React.FC<ChatScreenProps> = ({
  currentUser,
  allUsers,
  presenceMap,
  conversations,
  blockedIds,
  initialPeerId,
  darkMode,
  onToast,
}) => {
  const c = darkMode ? PALETTE.dark : PALETTE.light;
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [groupModal, setGroupModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!initialPeerId) return;
    const peer = allUsers.find((u) => u.uid === initialPeerId);
    if (peer) {
      void getOrCreateDirectConversation(currentUser, peer).then(setSelectedConv);
    }
  }, [initialPeerId, allUsers.length]);

  useEffect(() => {
    if (!selectedConv) {
      setMessages([]);
      return;
    }
    return subscribeMessages(selectedConv.id, currentUser.uid, setMessages);
  }, [selectedConv?.id, currentUser.uid]);

  if (selectedConv) {
    const peerId = !selectedConv.isGroup
      ? selectedConv.participants.find((id) => id !== currentUser.uid)
      : undefined;
    const peer = peerId ? allUsers.find((u) => u.uid === peerId) : undefined;
    const title = getConversationTitle(selectedConv, currentUser.uid);
    const pres = peerId ? presenceMap[peerId] : undefined;

    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
          <TouchableOpacity onPress={() => setSelectedConv(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="arrow-back" size={20} color={c.text} />
            <View>
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>{title}</Text>
              {peerId && (
                <Text style={{ color: c.muted, fontSize: 11 }}>
                  {pres?.isOnline ? 'Online' : pres?.lastSeen ? `Last seen ${formatRelativeTime(pres.lastSeen)}` : 'Offline'}
                </Text>
              )}
            </View>
          </TouchableOpacity>
          {peer && (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={async () => {
                  await startCallSession(currentUser, peer, 'audio');
                  onToast(`Voice calling ${peer.displayName}...`);
                }}
              >
                <Ionicons name="call-outline" size={20} color={c.teal} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  await startCallSession(currentUser, peer, 'video');
                  onToast(`Video calling ${peer.displayName}...`);
                }}
              >
                <Ionicons name="videocam-outline" size={22} color={c.teal} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 14, gap: 8 }}
          renderItem={({ item }) => {
            const mine = item.senderId === currentUser.uid;
            return (
              <View
                style={[
                  styles.bubble,
                  {
                    alignSelf: mine ? 'flex-end' : 'flex-start',
                    backgroundColor: mine ? c.teal : c.surface,
                    borderColor: c.border,
                    borderWidth: mine ? 0 : 1,
                  },
                ]}
              >
                {!mine && selectedConv.isGroup && (
                  <Text style={{ color: c.teal, fontSize: 10, fontWeight: '800' }}>{item.senderName}</Text>
                )}
                {!!item.mediaUrl &&
                  (item.mediaUrl.match(/\.(mp4|webm|mov)(\?|$)/i) ? (
                    <Video
                      source={{ uri: resolveMediaUrl(item.mediaUrl) }}
                      style={{ width: 210, height: 150, borderRadius: 12, marginBottom: 4 }}
                      useNativeControls
                      resizeMode={ResizeMode.COVER}
                    />
                  ) : (
                    <Image
                      source={{ uri: resolveMediaUrl(item.mediaUrl) }}
                      style={{ width: 210, height: 150, borderRadius: 12, marginBottom: 4 }}
                      resizeMode="cover"
                    />
                  ))}
                {!!item.text && <Text style={{ color: mine ? '#FFF' : c.text, fontSize: 14 }}>{item.text}</Text>}
              </View>
            );
          }}
        />

        {uploadingMedia && (
          <View style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border, gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: c.muted, fontSize: 12 }}>Uploading attachment...</Text>
              <Text style={{ color: c.teal, fontSize: 12, fontWeight: '800' }}>{uploadProgress}%</Text>
            </View>
            <View style={{ height: 5, borderRadius: 4, backgroundColor: c.bg, overflow: 'hidden' }}>
              <View style={{ width: `${Math.max(5, uploadProgress)}%`, height: '100%', backgroundColor: c.teal }} />
            </View>
          </View>
        )}

        {!!mediaUrl && !uploadingMedia && (
          <View style={{ paddingHorizontal: 14, paddingVertical: 6, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: c.teal, fontSize: 12, fontWeight: '700', flex: 1 }} numberOfLines={1}>
              Attachment ready
            </Text>
            <TouchableOpacity onPress={() => setMediaUrl('')}>
              <Text style={{ color: c.danger, fontSize: 12, fontWeight: '700' }}>Remove</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={[styles.composerBar, { backgroundColor: c.surface, borderTopColor: c.border }]}>
          <TouchableOpacity
            style={{ width: 42, height: 46, borderRadius: 12, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}
            disabled={uploadingMedia}
            onPress={async () => {
              const res = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.All,
                quality: 0.85,
              });
              if (res.canceled || !res.assets[0]) return;
              const asset = res.assets[0];
              setUploadingMedia(true);
              setUploadProgress(4);
              try {
                const kind = asset.type === 'video' ? 'video' : 'image';
                const uploaded = await compressAndUploadMedia(asset.uri, 'chats', kind, (pct) => setUploadProgress(pct));
                setMediaUrl(uploaded);
              } catch (err) {
                onToast(err instanceof Error ? err.message : 'Attachment upload failed');
              } finally {
                setUploadingMedia(false);
                setUploadProgress(0);
              }
            }}
          >
            <Ionicons name="image-outline" size={20} color={c.teal} />
          </TouchableOpacity>
          <TextInput
            placeholder="Message..."
            placeholderTextColor={c.muted}
            value={text}
            onChangeText={setText}
            style={[styles.input, { flex: 1, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
          />
          <TouchableOpacity
            style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: c.teal, alignItems: 'center', justifyContent: 'center', opacity: uploadingMedia ? 0.6 : 1 }}
            disabled={uploadingMedia}
            onPress={async () => {
              if (!text.trim() && !mediaUrl.trim()) return;
              await sendChatMessage({ conversation: selectedConv, sender: currentUser, text, mediaUrl });
              setText('');
              setMediaUrl('');
            }}
          >
            <Ionicons name="send" size={18} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const availablePeers = allUsers.filter((u) => u.uid !== currentUser.uid && !blockedIds.has(u.uid));

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <Text style={{ color: c.text, fontWeight: '800', fontSize: 16 }}>Messages</Text>
        <TouchableOpacity
          style={{ height: 34, paddingHorizontal: 12, borderRadius: 10, backgroundColor: c.teal, justifyContent: 'center' }}
          onPress={() => setGroupModal(true)}
        >
          <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>+ New Group</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>
        {conversations.map((conv) => {
          const label = getConversationTitle(conv, currentUser.uid);
          return (
            <TouchableOpacity
              key={conv.id}
              style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
              onPress={() => setSelectedConv(conv)}
            >
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>{label}</Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {conv.lastMessage || 'Open conversation'}
              </Text>
            </TouchableOpacity>
          );
        })}

        <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700', marginTop: 8 }}>Start New Direct Chat</Text>
        {availablePeers.slice(0, 15).map((peer) => (
          <TouchableOpacity
            key={peer.uid}
            style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, flexDirection: 'row', justifyContent: 'space-between' }]}
            onPress={async () => {
              const conv = await getOrCreateDirectConversation(currentUser, peer);
              setSelectedConv(conv);
            }}
          >
            <Text style={{ color: c.text, fontWeight: '700' }}>{peer.displayName}</Text>
            <Text style={{ color: c.teal, fontSize: 12, fontWeight: '700' }}>Chat</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal visible={groupModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 16 }}>Create Group Chat</Text>
            <TextInput
              placeholder="Group Name"
              placeholderTextColor={c.muted}
              value={groupName}
              onChangeText={setGroupName}
              style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
            <ScrollView style={{ maxHeight: 200 }}>
              {availablePeers.map((u) => {
                const picked = selectedUids.has(u.uid);
                return (
                  <TouchableOpacity
                    key={u.uid}
                    style={{ paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between' }}
                    onPress={() => {
                      const next = new Set(selectedUids);
                      if (picked) next.delete(u.uid);
                      else next.add(u.uid);
                      setSelectedUids(next);
                    }}
                  >
                    <Text style={{ color: c.text }}>{u.displayName}</Text>
                    <Ionicons name={picked ? 'checkbox' : 'square-outline'} size={20} color={c.teal} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={[styles.smallBtn, { flex: 1, borderWidth: 1, borderColor: c.border }]}
                onPress={() => setGroupModal(false)}
              >
                <Text style={{ color: c.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.smallBtn, { flex: 1, backgroundColor: c.teal }]}
                onPress={async () => {
                  if (!groupName.trim()) return;
                  const members = availablePeers.filter((u) => selectedUids.has(u.uid));
                  const conv = await createGroupConversation(currentUser, groupName, members);
                  setGroupModal(false);
                  setGroupName('');
                  setSelectedUids(new Set());
                  setSelectedConv(conv);
                }}
              >
                <Text style={{ color: '#FFF', fontWeight: '800' }}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    height: 56,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  card: { borderRadius: 16, borderWidth: 1, padding: 14 },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  composerBar: { padding: 10, borderTopWidth: 1, flexDirection: 'row', gap: 8 },
  input: { height: 46, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 18 },
  modalSheet: { borderRadius: 22, borderWidth: 1, padding: 18, gap: 12 },
  smallBtn: { height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
