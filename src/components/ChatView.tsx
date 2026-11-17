import React, { useEffect, useRef, useState } from 'react';
import {
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Phone,
  Plus,
  Send,
  Users,
  Video,
  X,
} from 'lucide-react';
import { t } from '../lib/i18n';
import { uploadMediaFile } from '../lib/mediaUpload';
import {
  createGroupConversation,
  ensureConversation,
  formatRelativeTime,
  sendChatMessage,
  subscribeMessages,
} from '../lib/socialApi';
import {
  ChatMessage,
  Conversation,
  LanguageCode,
  UserPresence,
  UserProfile,
} from '../types/social';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';

interface ChatViewProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  presenceMap: Record<string, UserPresence>;
  conversations: Conversation[];
  blockedIds: Set<string>;
  initialPeerId?: string | null;
  lang: LanguageCode;
  onStartCall: (peer: UserProfile, callType: 'audio' | 'video') => void;
  onSelectUser: (uid: string) => void;
  onToast: (msg: string) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  currentUser,
  allUsers,
  presenceMap,
  conversations,
  blockedIds,
  initialPeerId,
  lang,
  onStartCall,
  onSelectUser,
  onToast,
}) => {
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [sending, setSending] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!initialPeerId) return;
    const peer = allUsers.find((u) => u.uid === initialPeerId);
    if (peer && !blockedIds.has(peer.uid)) {
      void ensureConversation(currentUser, peer)
        .then((conv) => setSelectedConv(conv))
        .catch(() => {});
    }
  }, [initialPeerId, allUsers, blockedIds, currentUser]);

  useEffect(() => {
    if (!selectedConv && conversations.length > 0) {
      setSelectedConv(conversations[0]);
    }
  }, [conversations, selectedConv]);

  useEffect(() => {
    if (!selectedConv) {
      setMessages([]);
      return;
    }
    const unsub = subscribeMessages(selectedConv.id, currentUser.uid, (msgs) => {
      setMessages(msgs);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    });
    return () => unsub();
  }, [selectedConv, currentUser.uid]);

  const userById = new Map(allUsers.map((u) => [u.uid, u]));

  const getConversationMeta = (conv: Conversation) => {
    if (conv.isGroup) {
      return {
        title: conv.groupName || 'Group Circle',
        photo: conv.groupPhoto,
        peer: null as UserProfile | null,
        online: false,
        subtitle: `${conv.participants.length} members`,
      };
    }
    const peerId = conv.participants.find((id) => id !== currentUser.uid) || conv.participantB;
    const peer = userById.get(peerId) || null;
    const title =
      peer?.displayName ||
      (conv.participantA === currentUser.uid ? conv.participantBName : conv.participantAName);
    const photo =
      peer?.photoURL ||
      (conv.participantA === currentUser.uid ? conv.participantBPhoto : conv.participantAPhoto);
    const presence = presenceMap[peerId];
    const showStatus = peer?.showOnlineStatus !== false;
    const online = Boolean(showStatus && presence?.isOnline);
    const subtitle = showStatus
      ? online
        ? t(lang, 'online')
        : presence?.lastSeen
          ? `${t(lang, 'lastSeen')} ${formatRelativeTime(presence.lastSeen)}`
          : t(lang, 'offline')
      : 'BANDHU MELA';
    return { title, photo, peer, online, subtitle };
  };

  const handleAttachMedia = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setUploadProgress(2);
    try {
      const url = await uploadMediaFile(file, 'chats', currentUser.uid, {
        onProgress: (pct) => setUploadProgress(pct),
      });
      setMediaUrl(url);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConv || (!text.trim() && !mediaUrl.trim()) || sending) return;
    const meta = getConversationMeta(selectedConv);
    if (meta.peer && blockedIds.has(meta.peer.uid)) {
      onToast('Cannot send messages to a blocked user.');
      return;
    }
    setSending(true);
    try {
      await sendChatMessage(selectedConv, currentUser, text, mediaUrl);
      setText('');
      setMediaUrl('');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim() || selectedMembers.length === 0) {
      onToast('Enter a group name and select at least 1 friend.');
      return;
    }
    const members = allUsers.filter((u) => selectedMembers.includes(u.uid));
    const created = await createGroupConversation(currentUser, groupName, members);
    setSelectedConv(created);
    setGroupName('');
    setSelectedMembers([]);
    setShowGroupModal(false);
    onToast('Group chat created');
  };

  const activeMeta = selectedConv ? getConversationMeta(selectedConv) : null;
  const availableContacts = allUsers.filter((u) => u.uid !== currentUser.uid && !blockedIds.has(u.uid));

  return (
    <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-[600px]">
      {/* Left Conversations List */}
      <aside className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-[#E4DFD5] dark:border-[#262C30] flex flex-col">
        <div className="p-4 border-b border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold">{t(lang, 'chat')}</h2>
            <p className="text-xs text-zinc-500">1-to-1 &amp; Group Chats</p>
          </div>
          <button
            type="button"
            onClick={() => setShowGroupModal(true)}
            className="h-9 px-3 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-[#095454] cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t(lang, 'newGroup')}</span>
          </button>
        </div>

        {/* Quick Start Direct Chat */}
        {availableContacts.length > 0 && (
          <div className="p-3 border-b border-[#E4DFD5] dark:border-[#262C30] flex items-center gap-2 overflow-x-auto no-scrollbar">
            {availableContacts.slice(0, 12).map((u) => (
              <button
                key={u.uid}
                type="button"
                onClick={async () => {
                  const conv = await ensureConversation(currentUser, u);
                  setSelectedConv(conv);
                }}
                className="flex flex-col items-center gap-1 shrink-0 w-14 cursor-pointer"
              >
                <div className="relative">
                  <Avatar src={u.photoURL} name={u.displayName} size="sm" />
                  {u.showOnlineStatus !== false && presenceMap[u.uid]?.isOnline && (
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#171B1E]" />
                  )}
                </div>
                <span className="text-[10px] font-medium truncate w-full text-center">
                  {u.displayName.split(' ')[0]}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-[#E4DFD5]/60 dark:divide-[#262C30]/60 max-h-60 lg:max-h-[500px]">
          {conversations.length === 0 ? (
            <p className="p-6 text-xs text-zinc-500 text-center">
              Tap any friend above to start a real-time conversation or create a group.
            </p>
          ) : (
            conversations.map((conv) => {
              const meta = getConversationMeta(conv);
              const active = selectedConv?.id === conv.id;
              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => setSelectedConv(conv)}
                  className={`w-full p-3.5 flex items-center gap-3 text-left transition-colors cursor-pointer ${
                    active ? 'bg-[#0D6E6E]/10 dark:bg-teal-500/15' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                  }`}
                >
                  <div className="relative shrink-0">
                    {conv.isGroup ? (
                      <div className="w-10 h-10 rounded-full bg-[#0D6E6E]/15 text-[#0D6E6E] dark:text-teal-400 flex items-center justify-center">
                        <Users className="w-5 h-5" />
                      </div>
                    ) : (
                      <Avatar src={meta.photo} name={meta.title} size="md" />
                    )}
                    {meta.online && (
                      <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#171B1E]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold truncate flex items-center gap-1">
                        <span>{meta.title}</span>
                        {meta.peer?.isVerified && <VerifiedBadge className="w-3.5 h-3.5" />}
                      </p>
                      <span className="text-[11px] text-zinc-400 shrink-0">
                        {formatRelativeTime(conv.updatedAt)}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 truncate mt-0.5">
                      {conv.lastMessage || meta.subtitle}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Right Active Thread */}
      <section className="lg:col-span-8 flex flex-col h-[520px] lg:h-[620px]">
        {selectedConv && activeMeta ? (
          <>
            <div className="px-5 py-3.5 border-b border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  if (activeMeta.peer) onSelectUser(activeMeta.peer.uid);
                }}
                className="flex items-center gap-3 text-left min-w-0 cursor-pointer"
              >
                {selectedConv.isGroup ? (
                  <div className="w-10 h-10 rounded-full bg-[#0D6E6E]/15 text-[#0D6E6E] dark:text-teal-400 flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5" />
                  </div>
                ) : (
                  <Avatar src={activeMeta.photo} name={activeMeta.title} size="md" />
                )}
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate flex items-center gap-1.5">
                    <span>{activeMeta.title}</span>
                    {activeMeta.peer?.isVerified && <VerifiedBadge className="w-4 h-4" />}
                  </p>
                  <p className="text-xs text-zinc-500 truncate">{activeMeta.subtitle}</p>
                </div>
              </button>

              {activeMeta.peer && !blockedIds.has(activeMeta.peer.uid) && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onStartCall(activeMeta.peer!, 'audio')}
                    aria-label={t(lang, 'audioCall')}
                    className="w-10 h-10 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] hover:border-[#0D6E6E] flex items-center justify-center cursor-pointer"
                  >
                    <Phone className="w-4 h-4 text-[#0D6E6E] dark:text-teal-400" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartCall(activeMeta.peer!, 'video')}
                    aria-label={t(lang, 'videoCall')}
                    className="w-10 h-10 rounded-xl bg-[#0D6E6E] text-white hover:bg-[#095454] flex items-center justify-center cursor-pointer"
                  >
                    <Video className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-[#F7F5F0]/50 dark:bg-[#0E1113]/50">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-zinc-500 text-sm">
                  <MessageSquare className="w-8 h-8 mb-2 text-[#0D6E6E]" />
                  <p>Say hello to start your conversation on BANDHU MELA.</p>
                </div>
              ) : (
                messages.map((msg) => {
                  const mine = msg.senderId === currentUser.uid;
                  return (
                    <div key={msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm space-y-1.5 ${
                          mine
                            ? 'bg-[#0D6E6E] text-white'
                            : 'bg-white dark:bg-[#1E2327] border border-[#E4DFD5] dark:border-[#262C30] text-zinc-900 dark:text-zinc-100'
                        }`}
                      >
                        {selectedConv.isGroup && !mine && (
                          <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                            {msg.senderName}
                          </p>
                        )}
                        {msg.mediaUrl && (
                          msg.mediaUrl.match(/\.(mp4|webm|mov)(\?|$)/i) ? (
                            <video src={msg.mediaUrl} controls className="rounded-xl max-h-56 w-full object-contain" />
                          ) : (
                            <img
                              src={msg.mediaUrl}
                              alt="Attachment"
                              referrerPolicy="no-referrer"
                              className="rounded-xl max-h-56 w-full object-cover"
                            />
                          )
                        )}
                        {msg.text && <p className="break-words">{msg.text}</p>}
                        <p className={`text-[10px] ${mine ? 'text-teal-100/80' : 'text-zinc-400'}`}>
                          {formatRelativeTime(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>

            {uploading && (
              <div className="px-4 py-2 border-t border-[#E4DFD5] dark:border-[#262C30] bg-zinc-50 dark:bg-[#121618] space-y-1">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-zinc-600 dark:text-zinc-300">Uploading attachment...</span>
                  <span className="text-[#0D6E6E] dark:text-teal-400 font-bold">{uploadProgress}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-[#0D6E6E] transition-all duration-200" style={{ width: `${Math.max(4, uploadProgress)}%` }} />
                </div>
              </div>
            )}

            {mediaUrl && (
              <div className="px-4 py-2 border-t border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between text-xs bg-zinc-50 dark:bg-[#121618]">
                <span className="truncate text-[#0D6E6E] dark:text-teal-400 font-medium">
                  Attachment ready: {mediaUrl}
                </span>
                <button type="button" onClick={() => setMediaUrl('')} className="text-red-500 cursor-pointer ml-2">
                  Remove
                </button>
              </div>
            )}

            <form
              onSubmit={handleSend}
              className="p-3.5 border-t border-[#E4DFD5] dark:border-[#262C30] flex items-center gap-2"
            >
              <label className="w-11 h-11 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-center cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 shrink-0">
                {uploading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#0D6E6E]" />
                ) : (
                  <ImageIcon className="w-4 h-4 text-[#0D6E6E] dark:text-teal-400" />
                )}
                <input type="file" disabled={uploading} accept="image/*,video/*" onChange={handleAttachMedia} className="hidden" />
              </label>
              <input
                type="text"
                value={text}
                maxLength={2000}
                onChange={(e) => setText(e.target.value)}
                placeholder="Write a message..."
                className="flex-1 h-11 px-4 rounded-xl bg-[#F7F5F0] dark:bg-[#0E1113] text-sm focus:outline-none focus:ring-2 focus:ring-[#0D6E6E]/30"
              />
              <button
                type="submit"
                disabled={sending || (!text.trim() && !mediaUrl.trim())}
                className="w-11 h-11 rounded-xl bg-[#0D6E6E] text-white flex items-center justify-center hover:bg-[#095454] cursor-pointer disabled:opacity-50 shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500">
            <MessageSquare className="w-10 h-10 mb-3 text-[#0D6E6E]" />
            <h3 className="font-display text-lg font-bold text-zinc-900 dark:text-white">Samvad Lounge</h3>
            <p className="text-sm max-w-sm mt-1">
              Select a friend or group conversation to send messages, share photos, or start a voice/video call.
            </p>
          </div>
        )}
      </section>

      {/* Group Creation Modal */}
      {showGroupModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between">
              <h3 className="font-display text-base font-bold">Create Group Chat</h3>
              <button
                type="button"
                onClick={() => setShowGroupModal(false)}
                className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateGroup} className="p-6 space-y-4">
              <input
                type="text"
                required
                maxLength={80}
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name (e.g. Weekend Trekkers)"
                className="w-full h-11 px-4 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
              />
              <div className="max-h-56 overflow-y-auto space-y-2">
                {availableContacts.map((u) => {
                  const checked = selectedMembers.includes(u.uid);
                  return (
                    <label
                      key={u.uid}
                      className="flex items-center justify-between p-2.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar src={u.photoURL} name={u.displayName} size="sm" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{u.displayName}</p>
                          <p className="text-xs text-zinc-500 truncate">@{u.username}</p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedMembers((prev) =>
                            checked ? prev.filter((id) => id !== u.uid) : [...prev, u.uid].slice(0, 24)
                          )
                        }
                        className="accent-[#0D6E6E]"
                      />
                    </label>
                  );
                })}
              </div>
              <button
                type="submit"
                className="w-full h-11 rounded-xl bg-[#0D6E6E] text-white text-sm font-semibold hover:bg-[#095454] cursor-pointer"
              >
                Create Group ({selectedMembers.length} selected)
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
