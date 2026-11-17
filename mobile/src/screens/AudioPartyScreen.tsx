import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { AvatarFrame } from '../components/BandhuLogo';
import { LevelBadge } from '../components/LevelBadge';
import { LoveCoupleGiftModal, isLoveCoupleGiftMobile, LOVE_COUPLE_GIFT_DURATION_MS, STANDARD_GIFT_DURATION_MS } from '../components/LoveCoupleGiftModal';
import { PALETTE } from '../i18n/translations';
import {
  acceptSpeakerInvite,
  banAudioParticipant,
  computeLevelSummary,
  createAudioRoom,
  endAudioRoom,
  hashRoomPasscode,
  inviteToSpeak,
  joinAudioRoom,
  leaveAudioRoom,
  moveSpeakerToListener,
  recordVerifiedSpeakingSeconds,
  sendAudioRoomMessage,
  sendVirtualGift,
  subscribeAudioMessages,
  subscribeAudioParticipants,
  subscribeLiveAudioRooms,
  subscribeRoomGiftEvents,
  subscribeVirtualGifts,
  toggleParticipantMute,
  toggleRaiseHand,
  toggleRoomModerator,
  toMillis,
  VIP_EXCLUSIVE_EMOJIS,
} from '../services/api';
import { sendHostingRewardHeartbeat, sendSpeakingRewardHeartbeat } from '../services/economyApi';
import {
  AudioRoom,
  AudioRoomMessage,
  AudioRoomParticipant,
  GiftEvent,
  LevelConfig,
  SpeakingStats,
  UserProfile,
  UserWallet,
  VirtualGift,
} from '../types/social';

interface AudioPartyScreenProps {
  currentUser: UserProfile;
  wallet: UserWallet | null;
  levelConfig: LevelConfig;
  speakingStatsMap: Record<string, SpeakingStats>;
  allowAudioRooms: boolean;
  allowVirtualGifts: boolean;
  darkMode: boolean;
  onOpenWallet: () => void;
  onToast: (msg: string) => void;
}

const TOPICS = ['Open Adda', 'Music & Songs', 'Tech & Startups', 'Culture & Poetry', 'Sports'];
const REACTIONS = ['👏', '🔥', '💖', '🎵', '🪔', '🎉'];

export const AudioPartyScreen: React.FC<AudioPartyScreenProps> = ({
  currentUser,
  wallet,
  levelConfig,
  speakingStatsMap,
  allowAudioRooms,
  allowVirtualGifts,
  darkMode,
  onOpenWallet,
  onToast,
}) => {
  const c = darkMode ? PALETTE.dark : PALETTE.light;
  const [rooms, setRooms] = useState<AudioRoom[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<AudioRoomParticipant[]>([]);
  const [messages, setMessages] = useState<AudioRoomMessage[]>([]);
  const [gifts, setGifts] = useState<VirtualGift[]>([]);
  const [giftEvents, setGiftEvents] = useState<GiftEvent[]>([]);
  const [bannerGift, setBannerGift] = useState<GiftEvent | null>(null);
  const [fullScreenLoveGift, setFullScreenLoveGift] = useState<GiftEvent | null>(null);
  const [sendingGiftId, setSendingGiftId] = useState<string | null>(null);
  const [vipBannerName, setVipBannerName] = useState<string | null>(null);
  const giftAnim = useRef(new Animated.Value(0)).current;

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState(TOPICS[0]);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [vipOnly, setVipOnly] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);

  const [passPromptRoom, setPassPromptRoom] = useState<AudioRoom | null>(null);
  const [passInput, setPassInput] = useState('');
  const [chatText, setChatText] = useState('');
  const [giftTargetUid, setGiftTargetUid] = useState('');
  const [voiceActiveNow, setVoiceActiveNow] = useState(false);
  const [sessionSpeakingSec, setSessionSpeakingSec] = useState(0);

  const myStats = speakingStatsMap[currentUser.uid] || null;
  const mySummary = useMemo(() => computeLevelSummary(myStats, levelConfig), [myStats, levelConfig]);
  const levelConfigRef = useRef(levelConfig);
  levelConfigRef.current = levelConfig;
  const giftsRef = useRef<VirtualGift[]>(gifts);
  giftsRef.current = gifts;
  const vipAnnouncedRef = useRef<string | null>(null);
  const seenGiftIdsRef = useRef<Set<string>>(new Set());
  const giftInitRef = useRef<boolean>(false);
  const giftQueueRef = useRef<Array<GiftEvent & { animationType?: string }>>([]);
  const activeGiftIdRef = useRef<string | null>(null);
  const roomEnteredAtMsRef = useRef<number>(Date.now());
  const loveGiftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playNextMobileGift = () => {
    if (activeGiftIdRef.current !== null) return;
    const next = giftQueueRef.current.shift();
    if (!next) return;

    activeGiftIdRef.current = next.id;
    if (loveGiftTimerRef.current) {
      clearTimeout(loveGiftTimerRef.current);
      loveGiftTimerRef.current = null;
    }

    if (isLoveCoupleGiftMobile(next)) {
      setBannerGift(null);
      setFullScreenLoveGift(next);
      loveGiftTimerRef.current = setTimeout(() => {
        activeGiftIdRef.current = null;
        setFullScreenLoveGift(null);
        loveGiftTimerRef.current = null;
        playNextMobileGift();
      }, LOVE_COUPLE_GIFT_DURATION_MS);
    } else {
      setFullScreenLoveGift(null);
      setBannerGift(next);
      giftAnim.setValue(0);
      Animated.sequence([
        Animated.timing(giftAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
        Animated.delay(STANDARD_GIFT_DURATION_MS - 560),
        Animated.timing(giftAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]).start(() => {
        if (activeGiftIdRef.current === next.id) {
          activeGiftIdRef.current = null;
          setBannerGift(null);
          playNextMobileGift();
        }
      });
    }
  };

  const enqueueConfirmedGift = (rawEvent: GiftEvent & { animationType?: string }) => {
    if (!rawEvent?.id || seenGiftIdsRef.current.has(rawEvent.id)) return;
    seenGiftIdsRef.current.add(rawEvent.id);

    const catalogItem = giftsRef.current.find((g) => g.id === rawEvent.giftId);
    const resolved: GiftEvent & { animationType?: string } = {
      ...rawEvent,
      animationType: rawEvent.animationType || catalogItem?.animationType,
    };

    giftQueueRef.current.push(resolved);
    playNextMobileGift();
  };

  useEffect(() => {
    const u1 = subscribeLiveAudioRooms(setRooms);
    const u2 = subscribeVirtualGifts(setGifts);
    return () => {
      u1();
      u2();
    };
  }, []);

  const activeRoom = useMemo(() => rooms.find((r) => r.id === activeRoomId) || null, [rooms, activeRoomId]);

  useEffect(() => {
    if (loveGiftTimerRef.current) {
      clearTimeout(loveGiftTimerRef.current);
      loveGiftTimerRef.current = null;
    }
    activeGiftIdRef.current = null;
    giftQueueRef.current = [];
    setFullScreenLoveGift(null);
    setBannerGift(null);
    seenGiftIdsRef.current = new Set();
    giftInitRef.current = false;
    roomEnteredAtMsRef.current = Date.now();

    if (!activeRoomId) {
      setParticipants([]);
      setMessages([]);
      setGiftEvents([]);
      setSessionSpeakingSec(0);
      vipAnnouncedRef.current = null;
      return;
    }
    const u1 = subscribeAudioParticipants(activeRoomId, setParticipants);
    const u2 = subscribeAudioMessages(activeRoomId, setMessages);
    const u3 = subscribeRoomGiftEvents(activeRoomId, (events, meta) => {
      setGiftEvents(events);
      if (!giftInitRef.current) {
        if (meta?.fromCache && events.length === 0) {
          return;
        }
        const cutoffMs = roomEnteredAtMsRef.current - 4000;
        [...events].reverse().forEach((ev) => {
          const evMs = toMillis(ev.createdAt);
          if (evMs > 0 && evMs >= cutoffMs) {
            enqueueConfirmedGift(ev);
          } else {
            seenGiftIdsRef.current.add(ev.id);
          }
        });
        giftInitRef.current = true;
        return;
      }

      [...events].reverse().forEach((ev) => {
        if (!seenGiftIdsRef.current.has(ev.id)) {
          enqueueConfirmedGift(ev);
        }
      });
    });
    return () => {
      if (loveGiftTimerRef.current) {
        clearTimeout(loveGiftTimerRef.current);
        loveGiftTimerRef.current = null;
      }
      activeGiftIdRef.current = null;
      giftQueueRef.current = [];
      u1();
      u2();
      u3();
    };
  }, [activeRoomId, giftAnim]);

  const latestVipEntry = useMemo(() => {
    const entries = messages.filter((m) => m.kind === 'vip_entry');
    return entries[entries.length - 1] || null;
  }, [messages]);

  useEffect(() => {
    if (!latestVipEntry) return;
    setVipBannerName(latestVipEntry.senderName);
    const timer = setTimeout(() => setVipBannerName(null), 3200);
    return () => clearTimeout(timer);
  }, [latestVipEntry?.id]);

  const myPart = participants.find((p) => p.userId === currentUser.uid);
  const amHost = activeRoom?.hostId === currentUser.uid;
  const amMod = Boolean(amHost || activeRoom?.moderatorIds.includes(currentUser.uid));
  const speakers = participants.filter((p) => p.seatNumber > 0 && !p.isBanned);
  const listeners = participants.filter((p) => p.seatNumber === 0 && !p.isBanned);
  const raisedHands = listeners.filter((p) => p.handRaised);

  // Send one grand VIP entry message per room session if eligible
  useEffect(() => {
    if (!activeRoom || activeRoom.status !== 'live') return;
    if (!mySummary.isVip || !levelConfig.enableVipEntryAnimation) return;
    if (vipAnnouncedRef.current === activeRoom.id) return;
    vipAnnouncedRef.current = activeRoom.id;
    void sendAudioRoomMessage({
      roomId: activeRoom.id,
      sender: currentUser,
      kind: 'vip_entry',
      text: 'entered the Audio Party with VIP Grand Aura',
    }).catch(() => {});
  }, [activeRoom?.id, activeRoom?.status, mySummary.isVip, levelConfig.enableVipEntryAnimation, currentUser]);

  // Genuine Live Audio Speaking Tracker (ONLY live room + active seat >=1 + unmuted + foreground + genuine mic energy)
  useEffect(() => {
    const canTrack = Boolean(
      activeRoom &&
        activeRoom.status === 'live' &&
        myPart &&
        myPart.seatNumber >= 1 &&
        !myPart.isMuted
    );

    if (!canTrack || !activeRoom) {
      setVoiceActiveNow(false);
      return;
    }

    let cancelled = false;
    let recording: Audio.Recording | null = null;
    let appState = AppState.currentState;
    let activeMs = 0;
    let pendingSec = 0;
    const roomIdForFlush = activeRoom.id;

    const appSub = AppState.addEventListener('change', (nextState) => {
      appState = nextState;
      if (nextState !== 'active') setVoiceActiveNow(false);
    });

    const flushPending = async () => {
      if (pendingSec <= 0) return;
      const chunk = Math.min(25, pendingSec);
      pendingSec -= chunk;
      await recordVerifiedSpeakingSeconds({
        uid: currentUser.uid,
        activeSeconds: chunk,
        roomId: roomIdForFlush,
        config: levelConfigRef.current,
      }).catch(() => {});
      await sendSpeakingRewardHeartbeat({
        roomId: roomIdForFlush,
        activeSeconds: chunk,
      })
        .then((res) => {
          if (res.awardedCoins > 0) {
            onToast(`+${res.awardedCoins} active speaking coins earned!`);
          }
        })
        .catch(() => {});
    };

    const startMicMonitor = async () => {
      try {
        const perm = await Audio.requestPermissionsAsync();
        if (!perm.granted || cancelled) return;
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
        if (cancelled) return;
        const created = await Audio.Recording.createAsync({
          ...Audio.RecordingOptionsPresets.LOW_QUALITY,
          isMeteringEnabled: true,
        });
        if (cancelled) {
          await created.recording.stopAndUnloadAsync().catch(() => {});
          return;
        }
        recording = created.recording;
      } catch {
        setVoiceActiveNow(false);
      }
    };

    void startMicMonitor();

    const meterTimer = setInterval(async () => {
      if (cancelled || !recording || appState !== 'active') {
        setVoiceActiveNow(false);
        return;
      }
      try {
        const st = await recording.getStatusAsync();
        const speaking = Boolean(st.isRecording && typeof st.metering === 'number' && st.metering > -48);
        setVoiceActiveNow(speaking);
        if (speaking) {
          activeMs += 500;
          if (activeMs >= 1000) {
            const gained = Math.floor(activeMs / 1000);
            activeMs %= 1000;
            pendingSec += gained;
            setSessionSpeakingSec((s) => s + gained);
          }
        }
      } catch {
        setVoiceActiveNow(false);
      }
    }, 500);

    const flushTimer = setInterval(() => {
      void flushPending();
    }, 15000);

    return () => {
      cancelled = true;
      appSub.remove();
      clearInterval(meterTimer);
      clearInterval(flushTimer);
      setVoiceActiveNow(false);
      if (recording) {
        void recording.stopAndUnloadAsync().catch(() => {});
      }
      void flushPending();
    };
  }, [activeRoom?.id, activeRoom?.status, myPart?.seatNumber, myPart?.isMuted, currentUser.uid]);

  // Genuine Live Hosting Bonus Heartbeat (Android foreground + host only)
  useEffect(() => {
    if (!activeRoom || activeRoom.status !== 'live' || activeRoom.hostId !== currentUser.uid) {
      return;
    }
    let hostAppState = AppState.currentState;
    const sub = AppState.addEventListener('change', (nextState) => {
      hostAppState = nextState;
    });
    const timer = setInterval(() => {
      if (hostAppState !== 'active') return;
      void sendHostingRewardHeartbeat({ roomId: activeRoom.id, activeSeconds: 60 })
        .then((res) => {
          if (res.awardedCoins > 0) {
            onToast(`Hosting bonus: +${res.awardedCoins} coins earned!`);
          }
        })
        .catch(() => {});
    }, 60_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [activeRoom?.id, activeRoom?.status, activeRoom?.hostId, currentUser.uid]);

  const enterRoom = async (room: AudioRoom) => {
    if (room.vipOnly && levelConfig.enableVipRoomAccess && !mySummary.isVip && room.hostId !== currentUser.uid) {
      onToast('VIP-only room. Reach Level 5 VIP (100h active speaking this month) to enter.');
      return;
    }
    if (room.visibility === 'private' && room.hostId !== currentUser.uid) {
      setPassPromptRoom(room);
      return;
    }
    try {
      await joinAudioRoom(room, currentUser);
      setActiveRoomId(room.id);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to enter room');
    }
  };

  const handleCreateRoom = async () => {
    if (!title.trim()) {
      onToast('Enter a room title.');
      return;
    }
    setBusy(true);
    try {
      const room = await createAudioRoom({
        host: currentUser,
        title,
        topic,
        visibility,
        vipOnly,
        rawPasscode: passcode,
      });
      setTitle('');
      setPasscode('');
      setVipOnly(false);
      setCreateOpen(false);
      setActiveRoomId(room.id);
      onToast('Audio Party is Live!');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to create room');
    } finally {
      setBusy(false);
    }
  };

  const handleSendGift = async (gift: VirtualGift) => {
    if (sendingGiftId !== null) return;
    if (!activeRoom || !allowVirtualGifts) {
      onToast('Virtual gifts are currently disabled.');
      return;
    }
    const otherSpeakers = speakers.filter((s) => s.userId !== currentUser.uid);
    const otherListeners = listeners.filter((l) => l.userId !== currentUser.uid);
    const eligibleRecipients = otherSpeakers.length > 0 ? otherSpeakers : otherListeners;
    const selectedRecipient =
      eligibleRecipients.find((p) => p.userId === giftTargetUid) || eligibleRecipients[0];
    const recipient = selectedRecipient
      ? { uid: selectedRecipient.userId, displayName: selectedRecipient.displayName }
      : activeRoom.hostId !== currentUser.uid
      ? { uid: activeRoom.hostId, displayName: activeRoom.hostName }
      : null;

    if (!recipient) {
      onToast('Invite another speaker or listener into the room to send them a gift!');
      return;
    }

    setSendingGiftId(gift.id);
    try {
      const txResult = await sendVirtualGift({ room: activeRoom, sender: currentUser, recipient, gift });
      // Trigger animation only after Firestore transaction confirms coin deduction & gift delivery
      enqueueConfirmedGift({
        id: txResult.eventId,
        roomId: activeRoom.id,
        roomTitle: activeRoom.title,
        senderId: currentUser.uid,
        senderName: currentUser.displayName,
        senderPhoto: currentUser.photoURL,
        recipientId: recipient.uid,
        recipientName: recipient.displayName,
        giftId: gift.id,
        giftName: txResult.giftName,
        giftEmoji: txResult.giftEmoji,
        coinsCost: txResult.coinsCost,
        transactionId: txResult.transactionId,
        animationType: txResult.animationType,
        createdAt: Date.now(),
      });
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to send gift');
    } finally {
      setSendingGiftId(null);
    }
  };

  const dismissFullScreenGift = () => {
    if (loveGiftTimerRef.current) {
      clearTimeout(loveGiftTimerRef.current);
      loveGiftTimerRef.current = null;
    }
    activeGiftIdRef.current = null;
    setFullScreenLoveGift(null);
    playNextMobileGift();
  };

  if (activeRoom) {
    return (
      <View style={[styles.container, { backgroundColor: c.bg }]}>
        <LoveCoupleGiftModal gift={fullScreenLoveGift} onClose={dismissFullScreenGift} />
        {/* Animated Gift Overlay Banner */}
        {bannerGift && (
          <Animated.View
            style={[
              styles.giftBanner,
              {
                opacity: giftAnim,
                transform: [{ scale: giftAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
              },
            ]}
          >
            <Text style={{ fontSize: 32 }}>{bannerGift.giftEmoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 13 }}>
                {bannerGift.senderName} sent {bannerGift.giftName}
              </Text>
              <Text style={{ color: '#FDE68A', fontSize: 11 }}>
                to {bannerGift.recipientName} · {bannerGift.coinsCost} coins
              </Text>
            </View>
          </Animated.View>
        )}

        {/* VIP Grand Entry Banner */}
        {vipBannerName && (
          <View style={[styles.giftBanner, { backgroundColor: '#B45309' }]}>
            <Text style={{ fontSize: 22 }}>👑</Text>
            <Text style={{ color: '#FFF', fontWeight: '900', fontSize: 13, flex: 1 }}>
              VIP Entry: {vipBannerName} stepped into the Audio Party!
            </Text>
          </View>
        )}

        <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 30 }}>
          {/* Room Header */}
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: activeRoom.vipOnly ? '#F59E0B' : c.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.teal, fontSize: 11, fontWeight: '800' }}>
                  {activeRoom.topic} · {Math.max(participants.length, activeRoom.participantsCount)} in room
                  {activeRoom.vipOnly ? ' · 👑 VIP ONLY' : ''}
                </Text>
                <Text style={{ color: c.text, fontSize: 18, fontWeight: '800', marginTop: 2 }}>{activeRoom.title}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={[styles.iconChip, { borderColor: c.border }]}
                  onPress={() => Share.share({ message: `Join my BANDHU MELA Audio Party: ${activeRoom.title}` })}
                >
                  <Ionicons name="share-social-outline" size={18} color={c.teal} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.smallBtn, { backgroundColor: c.danger }]}
                  onPress={async () => {
                    if (amHost) {
                      Alert.alert('Close Room', 'End this Audio Party for everyone?', [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'End Room',
                          style: 'destructive',
                          onPress: async () => {
                            await endAudioRoom(activeRoom.id);
                            setActiveRoomId(null);
                          },
                        },
                      ]);
                    } else {
                      await leaveAudioRoom(activeRoom, currentUser.uid);
                      setActiveRoomId(null);
                    }
                  }}
                >
                  <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>
                    {amHost ? 'End Room' : 'Leave'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Genuine Speaking Time Status Pill */}
            {myPart && myPart.seatNumber >= 1 && (
              <View
                style={{
                  marginTop: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 10,
                  backgroundColor: myPart.isMuted ? `${c.danger}18` : voiceActiveNow ? `${c.teal}18` : c.bg,
                  borderWidth: 1,
                  borderColor: myPart.isMuted ? c.danger : voiceActiveNow ? c.teal : c.border,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: myPart.isMuted ? c.danger : c.text, fontSize: 11, fontWeight: '700' }}>
                  {myPart.isMuted
                    ? 'Mic Muted — Speaking time paused'
                    : voiceActiveNow
                    ? '🎙️ Speaking detected — Counting live level time'
                    : 'Speak into mic to log genuine level time'}
                </Text>
                <Text style={{ color: c.teal, fontSize: 11, fontWeight: '800' }}>+{sessionSpeakingSec}s</Text>
              </View>
            )}

            {/* 5 Speaker Seats Stage */}
            <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700', marginTop: 12, marginBottom: 8 }}>
              5 SPEAKER STAGE ({speakers.length}/5)
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[1, 2, 3, 4, 5].map((seatNo) => {
                const sp = speakers.find((s) => s.seatNumber === seatNo);
                const spStats = sp ? speakingStatsMap[sp.userId] : null;
                const spSum = sp ? computeLevelSummary(spStats, levelConfig) : null;
                const isVipSp = Boolean(spSum?.isVip);
                return (
                  <View
                    key={seatNo}
                    style={[
                      styles.seatCard,
                      {
                        backgroundColor: c.bg,
                        borderColor: sp
                          ? isVipSp && levelConfig.enableVipFrames
                            ? '#F59E0B'
                            : sp.isMuted
                            ? c.border
                            : c.teal
                          : c.border,
                      },
                    ]}
                  >
                    {sp ? (
                      <>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <AvatarFrame
                            uri={sp.photoURL}
                            name={sp.displayName}
                            size={28}
                            isVip={isVipSp && levelConfig.enableVipFrames}
                          />
                          <View style={{ flex: 1 }}>
                            <Text
                              style={{
                                color: isVipSp && levelConfig.enableVipNameColors ? '#D97706' : c.text,
                                fontWeight: '800',
                                fontSize: 12,
                              }}
                              numberOfLines={1}
                            >
                              {sp.displayName}
                            </Text>
                            <Text style={{ color: c.muted, fontSize: 9 }}>
                              {sp.role.toUpperCase()} {sp.isMuted ? '· MUTED' : '· LIVE'}
                            </Text>
                          </View>
                          <Ionicons
                            name={sp.isMuted ? 'mic-off' : 'mic'}
                            size={15}
                            color={sp.isMuted ? c.danger : c.teal}
                          />
                        </View>
                        <LevelBadge stats={spStats} config={levelConfig} compact />
                        {amMod && sp.userId !== currentUser.uid && (
                          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                            <TouchableOpacity
                              onPress={() => toggleParticipantMute(activeRoom.id, sp.userId, sp.isMuted)}
                            >
                              <Ionicons name={sp.isMuted ? 'mic-outline' : 'mic-off-outline'} size={15} color={c.text} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => moveSpeakerToListener(activeRoom, sp.userId)}>
                              <Ionicons name="arrow-down-circle-outline" size={15} color={c.marigold} />
                            </TouchableOpacity>
                            {amHost && (
                              <TouchableOpacity
                                onPress={() =>
                                  toggleRoomModerator(
                                    activeRoom,
                                    sp.userId,
                                    !activeRoom.moderatorIds.includes(sp.userId)
                                  )
                                }
                              >
                                <Ionicons name="shield-outline" size={15} color={c.teal} />
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity onPress={() => banAudioParticipant(activeRoom, sp.userId)}>
                              <Ionicons name="ban-outline" size={15} color={c.danger} />
                            </TouchableOpacity>
                          </View>
                        )}
                      </>
                    ) : (
                      <Text style={{ color: c.muted, fontSize: 11 }}>Open Seat {seatNo}</Text>
                    )}
                  </View>
                );
              })}
            </View>

            {/* My Speaker / Listener Controls */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {myPart && myPart.seatNumber >= 1 ? (
                <TouchableOpacity
                  style={[styles.smallBtn, { backgroundColor: myPart.isMuted ? c.danger : c.teal }]}
                  onPress={() => toggleParticipantMute(activeRoom.id, currentUser.uid, myPart.isMuted)}
                >
                  <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>
                    {myPart.isMuted ? 'Unmute Mic' : 'Mute Mic'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.smallBtn, { backgroundColor: myPart?.handRaised ? c.marigold : c.teal }]}
                  onPress={() => toggleRaiseHand(activeRoom.id, currentUser.uid, Boolean(myPart?.handRaised))}
                >
                  <Text style={{ color: myPart?.handRaised ? '#14171A' : '#FFF', fontSize: 12, fontWeight: '700' }}>
                    {myPart?.handRaised ? 'Lower Hand' : 'Raise Hand'}
                  </Text>
                </TouchableOpacity>
              )}

              {myPart?.invitedToSpeak && myPart.seatNumber === 0 && (
                <TouchableOpacity
                  style={[styles.smallBtn, { backgroundColor: c.marigold }]}
                  onPress={async () => {
                    try {
                      await acceptSpeakerInvite(activeRoom, currentUser.uid, participants);
                    } catch (err) {
                      onToast(err instanceof Error ? err.message : 'Unable to take seat');
                    }
                  }}
                >
                  <Text style={{ color: '#14171A', fontSize: 12, fontWeight: '800' }}>Accept Mic Invite!</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.smallBtn, { borderWidth: 1, borderColor: c.border }]}
                onPress={onOpenWallet}
              >
                <Text style={{ color: c.marigold, fontSize: 12, fontWeight: '800' }}>
                  🪙 {wallet?.coinsBalance ?? 0} Coins
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Host/Mod Raised Hand Queue */}
          {amMod && raisedHands.length > 0 && (
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.marigold }]}>
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 13, marginBottom: 6 }}>
                Raised Hands ({raisedHands.length})
              </Text>
              {raisedHands.map((lh) => (
                <View
                  key={lh.userId}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}
                >
                  <Text style={{ color: c.text, fontSize: 13 }}>{lh.displayName}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      style={[styles.smallBtn, { backgroundColor: c.teal }]}
                      onPress={() => inviteToSpeak(activeRoom.id, lh.userId, true)}
                    >
                      <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700' }}>Invite to Speak</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => banAudioParticipant(activeRoom, lh.userId)}>
                      <Ionicons name="ban-outline" size={18} color={c.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Virtual Gifts Bar */}
          {allowVirtualGifts && (
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 13 }}>Send Virtual Gift to Speaker</Text>
                <TouchableOpacity onPress={onOpenWallet}>
                  <Text style={{ color: c.teal, fontSize: 12, fontWeight: '700' }}>Top Up</Text>
                </TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 8 }}>
                {(speakers.filter((s) => s.userId !== currentUser.uid).length > 0
                  ? speakers.filter((s) => s.userId !== currentUser.uid)
                  : listeners.filter((l) => l.userId !== currentUser.uid)
                ).map((sp) => (
                    <TouchableOpacity
                      key={sp.userId}
                      style={[
                        styles.chip,
                        {
                          borderColor: giftTargetUid === sp.userId ? c.teal : c.border,
                          backgroundColor: giftTargetUid === sp.userId ? c.teal : c.bg,
                        },
                      ]}
                      onPress={() => setGiftTargetUid(sp.userId)}
                    >
                      <Text style={{ color: giftTargetUid === sp.userId ? '#FFF' : c.text, fontSize: 11, fontWeight: '700' }}>
                        To: {sp.displayName}
                      </Text>
                    </TouchableOpacity>
                  ))}
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {gifts
                  .filter((g) => g.active)
                  .map((g) => {
                    const isCouple = g.id === 'gift_love_couple' || g.animationType === 'couple_love';
                    const isSending = sendingGiftId === g.id;
                    return (
                      <TouchableOpacity
                        key={g.id}
                        disabled={Boolean(sendingGiftId)}
                        style={[
                          styles.giftCard,
                          {
                            backgroundColor: isCouple ? 'rgba(244, 63, 94, 0.12)' : c.bg,
                            borderColor: isCouple ? '#F43F5E' : c.border,
                            opacity: sendingGiftId && !isSending ? 0.5 : 1,
                          },
                        ]}
                        onPress={() => handleSendGift(g)}
                      >
                        <Text style={{ fontSize: 22 }}>{g.emoji}</Text>
                        <Text style={{ color: c.text, fontSize: 11, fontWeight: '700' }} numberOfLines={1}>
                          {g.name}
                        </Text>
                        <Text style={{ color: isCouple ? '#FB7185' : c.marigold, fontSize: 11, fontWeight: '800' }}>
                          {isSending ? 'Sending...' : `${g.coinPrice} 🪙`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
              </ScrollView>
            </View>
          )}

          {/* Reactions, VIP Emojis & Room Chat */}
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, gap: 8 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              {REACTIONS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  style={{ width: 42, height: 36, borderRadius: 12, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}
                  onPress={() =>
                    sendAudioRoomMessage({
                      roomId: activeRoom.id,
                      sender: currentUser,
                      kind: 'reaction',
                      text: `reacted ${emoji}`,
                    })
                  }
                >
                  <Text style={{ fontSize: 18 }}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {mySummary.isVip && levelConfig.enableVipExclusiveEmojis && (
              <View style={{ gap: 4 }}>
                <Text style={{ color: '#D97706', fontSize: 10, fontWeight: '800' }}>👑 VIP EXCLUSIVE EMOJIS</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {VIP_EXCLUSIVE_EMOJIS.map((emoji) => (
                    <TouchableOpacity
                      key={emoji}
                      style={{
                        width: 40,
                        height: 34,
                        borderRadius: 10,
                        backgroundColor: '#F59E0B1A',
                        borderWidth: 1,
                        borderColor: '#F59E0B66',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      onPress={() =>
                        sendAudioRoomMessage({
                          roomId: activeRoom.id,
                          sender: currentUser,
                          kind: 'reaction',
                          text: `sent VIP ${emoji}`,
                        })
                      }
                    >
                      <Text style={{ fontSize: 17 }}>{emoji}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            <View style={{ maxHeight: 190, gap: 3 }}>
              {messages.slice(-15).map((m) => {
                const senderVip = computeLevelSummary(speakingStatsMap[m.senderId], levelConfig).isVip;
                return (
                  <Text
                    key={m.id}
                    style={{
                      color:
                        m.kind === 'gift' || m.kind === 'vip_entry'
                          ? '#D97706'
                          : c.text,
                      fontSize: 12,
                      marginVertical: 1,
                    }}
                  >
                    <Text
                      style={{
                        fontWeight: '800',
                        color: senderVip && levelConfig.enableVipNameColors ? '#D97706' : c.text,
                      }}
                    >
                      {senderVip ? '👑 ' : ''}
                      {m.senderName}:{' '}
                    </Text>
                    {m.text}
                  </Text>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                placeholder="Say something in room chat..."
                placeholderTextColor={c.muted}
                value={chatText}
                onChangeText={setChatText}
                style={[styles.input, { flex: 1, borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
              <TouchableOpacity
                style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: c.teal, alignItems: 'center', justifyContent: 'center' }}
                onPress={async () => {
                  if (!chatText.trim()) return;
                  await sendAudioRoomMessage({
                    roomId: activeRoom.id,
                    sender: currentUser,
                    kind: 'chat',
                    text: chatText,
                  });
                  setChatText('');
                }}
              >
                <Ionicons name="send" size={18} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
        <View
          style={[
            styles.card,
            { backgroundColor: c.surface, borderColor: c.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 17, fontWeight: '800' }}>BANDHU MELA Audio Party</Text>
            <Text style={{ color: c.muted, fontSize: 12 }}>5 speaker seats • Unlimited listeners • Virtual gifts</Text>
          </View>
          {allowAudioRooms && (
            <TouchableOpacity style={[styles.smallBtn, { backgroundColor: c.teal }]} onPress={() => setCreateOpen(true)}>
              <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 12 }}>+ Start Room</Text>
            </TouchableOpacity>
          )}
        </View>

        {rooms.length === 0 ? (
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, alignItems: 'center', padding: 26 }]}>
            <Text style={{ color: c.muted, textAlign: 'center' }}>
              No live audio rooms right now. Start the first Audio Party!
            </Text>
          </View>
        ) : (
          rooms.map((rm) => (
            <TouchableOpacity
              key={rm.id}
              style={[
                styles.card,
                { backgroundColor: c.surface, borderColor: rm.vipOnly ? '#F59E0B' : c.border, gap: 6 },
              ]}
              onPress={() => enterRoom(rm)}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: c.teal, fontSize: 11, fontWeight: '800' }}>
                  {rm.topic} · {rm.visibility === 'private' ? 'PRIVATE' : 'PUBLIC'}
                  {rm.vipOnly ? ' · 👑 VIP ONLY' : ''}
                </Text>
                <Text style={{ color: c.marigold, fontSize: 11, fontWeight: '800' }}>
                  {rm.participantsCount} in room
                </Text>
              </View>
              <Text style={{ color: c.text, fontSize: 16, fontWeight: '800' }}>{rm.title}</Text>
              <Text style={{ color: c.muted, fontSize: 12 }}>Host: {rm.hostName}</Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Create Audio Room Modal */}
      <Modal visible={createOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={{ color: c.text, fontSize: 16, fontWeight: '800' }}>Create Audio Party</Text>
            <TextInput
              placeholder="Room Title"
              placeholderTextColor={c.muted}
              value={title}
              onChangeText={setTitle}
              style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {TOPICS.map((tp) => (
                <TouchableOpacity
                  key={tp}
                  style={[styles.chip, { backgroundColor: topic === tp ? c.teal : c.bg, borderColor: c.border }]}
                  onPress={() => setTopic(tp)}
                >
                  <Text style={{ color: topic === tp ? '#FFF' : c.text, fontSize: 11, fontWeight: '700' }}>{tp}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['public', 'private'] as const).map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[
                    styles.smallBtn,
                    { flex: 1, backgroundColor: visibility === v ? c.teal : c.bg, borderWidth: 1, borderColor: c.border },
                  ]}
                  onPress={() => setVisibility(v)}
                >
                  <Text style={{ color: visibility === v ? '#FFF' : c.text, fontWeight: '700', fontSize: 12 }}>
                    {v === 'public' ? 'Public Room' : 'Private (Passcode)'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {levelConfig.enableVipRoomAccess && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: c.text, fontSize: 13, fontWeight: '700' }}>👑 VIP-Only Audio Room</Text>
                <Switch value={vipOnly} onValueChange={setVipOnly} />
              </View>
            )}
            {visibility === 'private' && (
              <TextInput
                placeholder="Room Passcode"
                placeholderTextColor={c.muted}
                value={passcode}
                onChangeText={setPasscode}
                style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
              />
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={[styles.smallBtn, { flex: 1, borderWidth: 1, borderColor: c.border }]}
                onPress={() => setCreateOpen(false)}
              >
                <Text style={{ color: c.text, fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.smallBtn, { flex: 1, backgroundColor: c.teal }]}
                onPress={handleCreateRoom}
                disabled={busy}
              >
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: '#FFF', fontWeight: '800' }}>Go Live</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Private Room Passcode Modal */}
      <Modal visible={Boolean(passPromptRoom)} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }}>Enter Private Room Passcode</Text>
            <TextInput
              placeholder="Passcode"
              placeholderTextColor={c.muted}
              secureTextEntry
              value={passInput}
              onChangeText={setPassInput}
              style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.bg }]}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={[styles.smallBtn, { flex: 1, borderWidth: 1, borderColor: c.border }]}
                onPress={() => {
                  setPassPromptRoom(null);
                  setPassInput('');
                }}
              >
                <Text style={{ color: c.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.smallBtn, { flex: 1, backgroundColor: c.teal }]}
                onPress={async () => {
                  if (!passPromptRoom) return;
                  const h = await hashRoomPasscode(passPromptRoom.id, passInput);
                  if (passPromptRoom.passcodeHash && h !== passPromptRoom.passcodeHash) {
                    onToast('Incorrect passcode.');
                    return;
                  }
                  await joinAudioRoom(passPromptRoom, currentUser);
                  setActiveRoomId(passPromptRoom.id);
                  setPassPromptRoom(null);
                  setPassInput('');
                }}
              >
                <Text style={{ color: '#FFF', fontWeight: '800' }}>Unlock</Text>
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
  card: { borderRadius: 20, borderWidth: 1, padding: 14 },
  smallBtn: { height: 38, paddingHorizontal: 14, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  iconChip: { width: 38, height: 38, borderRadius: 12, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  seatCard: { width: '48%', minHeight: 86, borderRadius: 14, borderWidth: 1, padding: 10, justifyContent: 'center', gap: 4 },
  chip: { paddingHorizontal: 12, height: 32, borderRadius: 10, borderWidth: 1, justifyContent: 'center' },
  giftCard: { width: 88, borderRadius: 14, borderWidth: 1, padding: 8, alignItems: 'center', gap: 2 },
  input: { height: 46, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, fontSize: 14 },
  giftBanner: {
    margin: 12,
    marginBottom: 0,
    borderRadius: 16,
    backgroundColor: '#0D6E6E',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 18 },
  modalSheet: { borderRadius: 22, borderWidth: 1, padding: 18, gap: 12 },
});
