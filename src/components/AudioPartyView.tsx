import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  Ban,
  Coins,
  Crown,
  Gift,
  Hand,
  Headphones,
  Lock,
  Mic,
  MicOff,
  PhoneOff,
  Plus,
  Send,
  Share2,
  Shield,
  Sparkles,
  UserCheck,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import {
  acceptSpeakerInvite,
  assignSpeakerSeatMod,
  banAudioParticipant,
  createAudioRoom,
  endAudioRoom,
  hashRoomPasscode,
  inviteToSpeak,
  joinAudioRoom,
  leaveAudioRoom,
  moveSpeakerToListener,
  sendAudioRoomMessage,
  sendAudioSignal,
  sendVirtualGift,
  subscribeAudioMessages,
  subscribeAudioParticipants,
  subscribeAudioSignals,
  subscribeLiveAudioRooms,
  subscribeRoomGiftEvents,
  subscribeVirtualGifts,
  toggleParticipantMute,
  toggleRaiseHand,
  toggleRoomModerator,
} from '../lib/audioPartyApi';
import { sendHostingRewardHeartbeat, sendSpeakingRewardHeartbeat } from '../lib/economyApi';
import {
  computeLevelSummary,
  DEFAULT_LEVEL_CONFIG,
  recordVerifiedSpeakingSeconds,
  VIP_EXCLUSIVE_EMOJIS,
} from '../lib/levelVipApi';
import { formatRelativeTime, toMillis } from '../lib/socialApi';
import {
  AudioRoom,
  AudioRoomMessage,
  AudioRoomParticipant,
  GiftEvent,
  LanguageCode,
  LevelConfig,
  SpeakingStats,
  UserProfile,
  UserWallet,
  VirtualGift,
} from '../types/social';
import { Avatar } from './Avatar';
import {
  GiftAnimationOverlay,
  isLoveCoupleGift,
  LOVE_COUPLE_GIFT_DURATION_MS,
  STANDARD_GIFT_DURATION_MS,
} from './GiftAnimationOverlay';
import { LevelBadge } from './LevelBadge';
import { VerifiedBadge } from './VerifiedBadge';

interface AudioPartyViewProps {
  currentUser: UserProfile;
  wallet: UserWallet | null;
  verifiedUserIds: Set<string>;
  blockedIds: Set<string>;
  allowAudioRooms: boolean;
  allowVirtualGifts: boolean;
  initialRoomId?: string | null;
  levelConfig?: LevelConfig;
  speakingStatsMap?: Record<string, SpeakingStats>;
  lang: LanguageCode;
  onOpenWallet: () => void;
  onSelectUser: (uid: string) => void;
  onToast: (msg: string) => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

const QUICK_REACTIONS = ['👏', '🔥', '💖', '🎵', '🪔', '🎉'];
const ROOM_TOPICS = ['Open Adda', 'Music & Songs', 'Tech & Startups', 'Culture & Poetry', 'Cricket & Sports', 'Night Chill'];

export const AudioPartyView: React.FC<AudioPartyViewProps> = ({
  currentUser,
  wallet,
  verifiedUserIds,
  blockedIds,
  allowAudioRooms,
  allowVirtualGifts,
  initialRoomId,
  levelConfig = DEFAULT_LEVEL_CONFIG,
  speakingStatsMap = {},
  onOpenWallet,
  onSelectUser,
  onToast,
}) => {
  const [rooms, setRooms] = useState<AudioRoom[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<AudioRoomParticipant[]>([]);
  const [messages, setMessages] = useState<AudioRoomMessage[]>([]);
  const [gifts, setGifts] = useState<VirtualGift[]>([]);
  const [roomGiftEvents, setRoomGiftEvents] = useState<GiftEvent[]>([]);
  const [activeGiftBanner, setActiveGiftBanner] = useState<(GiftEvent & { animationType?: string }) | null>(null);
  const [vipEntryBanner, setVipEntryBanner] = useState<{ id: string; senderName: string } | null>(null);
  const [isVoiceDetected, setIsVoiceDetected] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newTopic, setNewTopic] = useState('Open Adda');
  const [newVisibility, setNewVisibility] = useState<'public' | 'private'>('public');
  const [newVipOnly, setNewVipOnly] = useState(false);
  const [newPasscode, setNewPasscode] = useState('');
  const [creating, setCreating] = useState(false);

  const [privatePromptRoom, setPrivatePromptRoom] = useState<AudioRoom | null>(null);
  const [privatePassInput, setPrivatePassInput] = useState('');

  const [chatText, setChatText] = useState('');
  const [giftTargetUid, setGiftTargetUid] = useState<string>('');
  const [sendingGiftId, setSendingGiftId] = useState<string | null>(null);
  const [rtcStatus, setRtcStatus] = useState<string>('Ready');

  // WebRTC audio refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const seenGiftIdsRef = useRef<Set<string>>(new Set());
  const giftInitRef = useRef<boolean>(false);
  const giftQueueRef = useRef<Array<GiftEvent & { animationType?: string }>>([]);
  const activeGiftIdRef = useRef<string | null>(null);
  const roomEnteredAtMsRef = useRef<number>(Date.now());
  const giftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const giftsRef = useRef<VirtualGift[]>([]);
  giftsRef.current = gifts;
  const seenVipEntryIdRef = useRef<string>('');

  const playNextQueuedGift = () => {
    if (activeGiftIdRef.current !== null) return;
    const next = giftQueueRef.current.shift();
    if (!next) return;

    activeGiftIdRef.current = next.id;
    setActiveGiftBanner(next);

    if (giftTimerRef.current) {
      clearTimeout(giftTimerRef.current);
    }
    const durationMs = isLoveCoupleGift(next)
      ? LOVE_COUPLE_GIFT_DURATION_MS
      : STANDARD_GIFT_DURATION_MS;
    giftTimerRef.current = setTimeout(() => {
      activeGiftIdRef.current = null;
      setActiveGiftBanner(null);
      giftTimerRef.current = null;
      playNextQueuedGift();
    }, durationMs);
  };

  const enqueueConfirmedGift = (rawEvent: GiftEvent & { animationType?: string }) => {
    if (!rawEvent?.id || seenGiftIdsRef.current.has(rawEvent.id)) return;
    seenGiftIdsRef.current.add(rawEvent.id);

    const catalogItem = giftsRef.current.find((g) => g.id === rawEvent.giftId);
    const resolvedEvent: GiftEvent & { animationType?: string } = {
      ...rawEvent,
      animationType: rawEvent.animationType || catalogItem?.animationType,
    };

    giftQueueRef.current.push(resolvedEvent);
    playNextQueuedGift();
  };

  const myLevelSummary = useMemo(
    () => computeLevelSummary(speakingStatsMap[currentUser.uid], levelConfig),
    [speakingStatsMap, currentUser.uid, levelConfig]
  );

  useEffect(() => {
    const u1 = subscribeLiveAudioRooms(setRooms);
    const u2 = subscribeVirtualGifts(setGifts);
    return () => {
      u1();
      u2();
    };
  }, []);

  const activeRoom = useMemo(
    () => rooms.find((r) => r.id === activeRoomId) || null,
    [rooms, activeRoomId]
  );

  // Auto-open shared deep-link room (?room=...)
  useEffect(() => {
    if (!initialRoomId || activeRoomId || rooms.length === 0) return;
    const target = rooms.find((r) => r.id === initialRoomId);
    if (target) {
      if (target.visibility === 'private' && target.hostId !== currentUser.uid) {
        setPrivatePromptRoom(target);
      } else {
        void handleEnterRoom(target);
      }
    }
  }, [initialRoomId, rooms.length]);

  useEffect(() => {
    if (giftTimerRef.current) {
      clearTimeout(giftTimerRef.current);
      giftTimerRef.current = null;
    }
    activeGiftIdRef.current = null;
    giftQueueRef.current = [];
    setActiveGiftBanner(null);
    seenGiftIdsRef.current = new Set();
    giftInitRef.current = false;
    roomEnteredAtMsRef.current = Date.now();

    if (!activeRoomId) {
      setParticipants([]);
      setMessages([]);
      setRoomGiftEvents([]);
      return;
    }
    const u1 = subscribeAudioParticipants(activeRoomId, setParticipants);
    const u2 = subscribeAudioMessages(activeRoomId, (msgs) => {
      setMessages(msgs);
      const latestVip = [...msgs].reverse().find((m) => m.kind === 'vip_entry');
      if (latestVip && latestVip.id !== seenVipEntryIdRef.current) {
        seenVipEntryIdRef.current = latestVip.id;
        setVipEntryBanner({ id: latestVip.id, senderName: latestVip.senderName });
        setTimeout(() => {
          setVipEntryBanner((prev) => (prev?.id === latestVip.id ? null : prev));
        }, 4200);
      }
    });
    const u3 = subscribeRoomGiftEvents(activeRoomId, (events, meta) => {
      setRoomGiftEvents(events);

      if (!giftInitRef.current) {
        // Do not lock initialization on an empty cached snapshot before server sync arrives
        if (meta?.fromCache && events.length === 0) {
          return;
        }
        const cutoffMs = roomEnteredAtMsRef.current - 4000;
        const orderedAsc = [...events].reverse();
        orderedAsc.forEach((ev) => {
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

      const orderedAsc = [...events].reverse();
      orderedAsc.forEach((ev) => {
        if (!seenGiftIdsRef.current.has(ev.id)) {
          enqueueConfirmedGift(ev);
        }
      });
    });
    return () => {
      if (giftTimerRef.current) {
        clearTimeout(giftTimerRef.current);
        giftTimerRef.current = null;
      }
      activeGiftIdRef.current = null;
      giftQueueRef.current = [];
      u1();
      u2();
      u3();
    };
  }, [activeRoomId]);

  const myParticipant = useMemo(
    () => participants.find((p) => p.userId === currentUser.uid) || null,
    [participants, currentUser.uid]
  );

  const isOnStage = Boolean(myParticipant && myParticipant.seatNumber >= 1 && !myParticipant.isBanned);
  const isHostOrMod = Boolean(
    activeRoom &&
      (activeRoom.hostId === currentUser.uid || activeRoom.moderatorIds.includes(currentUser.uid))
  );

  // If banned or room ended while inside, leave gracefully
  useEffect(() => {
    if (myParticipant?.isBanned && activeRoom) {
      cleanupWebRTC();
      setActiveRoomId(null);
      onToast('You were removed from this Audio Party room.');
    }
  }, [myParticipant?.isBanned]);

  // Clean up on browser close/refresh
  useEffect(() => {
    if (!activeRoom) return;
    const onUnload = () => {
      cleanupWebRTC();
      void leaveAudioRoom(activeRoom, currentUser.uid);
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [activeRoom?.id, currentUser.uid]);

  const cleanupWebRTC = () => {
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    audioElsRef.current.forEach((el) => {
      el.pause();
      el.srcObject = null;
    });
    audioElsRef.current.clear();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((tr) => tr.stop());
      localStreamRef.current = null;
    }
    setRtcStatus('Ready');
  };

  // Acquire mic when user is on stage & sync mute state
  useEffect(() => {
    if (!activeRoom || !isOnStage) {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const initMic = async () => {
      try {
        if (!localStreamRef.current && navigator.mediaDevices?.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          localStreamRef.current = stream;
          setRtcStatus('Mic live on WebRTC');
        }
        if (localStreamRef.current) {
          const muted = Boolean(myParticipant?.isMuted);
          localStreamRef.current.getAudioTracks().forEach((tr) => {
            tr.enabled = !muted;
          });
        }
      } catch {
        setRtcStatus('Listening only (mic blocked)');
      }
    };
    void initMic();

    return () => {
      cancelled = true;
    };
  }, [activeRoom?.id, isOnStage, myParticipant?.isMuted]);

  // Genuine Live Audio Speaking Time Tracker (Foreground + Unmuted + On Stage + Real Mic RMS Activity)
  useEffect(() => {
    if (!activeRoom || activeRoom.status !== 'live' || !isOnStage || myParticipant?.isMuted) {
      setIsVoiceDetected(false);
      return;
    }

    let stopped = false;
    let accumulatedSec = 0;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let dataArray: Uint8Array<ArrayBuffer> | null = null;

    const attachAnalyser = () => {
      if (analyser || !localStreamRef.current) return;
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new Ctx();
        const src = audioCtx.createMediaStreamSource(localStreamRef.current);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        dataArray = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      } catch {
        analyser = null;
      }
    };

    const sampleTimer = setInterval(() => {
      if (stopped) return;
      if (document.visibilityState !== 'visible') {
        setIsVoiceDetected(false);
        return;
      }
      if (!analyser) attachAnalyser();
      if (!analyser || !dataArray) return;

      analyser.getByteTimeDomainData(dataArray);
      let sumSq = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const norm = (dataArray[i] - 128) / 128;
        sumSq += norm * norm;
      }
      const rms = Math.sqrt(sumSq / dataArray.length);
      const speakingNow = rms >= 0.015;
      setIsVoiceDetected(speakingNow);
      if (speakingNow) {
        accumulatedSec = Math.min(25, accumulatedSec + 1);
      }
    }, 1000);

    const flushTimer = setInterval(() => {
      if (stopped || document.visibilityState !== 'visible') return;
      if (accumulatedSec > 0) {
        const delta = accumulatedSec;
        accumulatedSec = 0;
        void recordVerifiedSpeakingSeconds({
          uid: currentUser.uid,
          activeSeconds: delta,
          roomId: activeRoom.id,
          config: levelConfig,
        }).catch(() => {});
        void sendSpeakingRewardHeartbeat({
          roomId: activeRoom.id,
          activeSeconds: delta,
        })
          .then((res) => {
            if (res.awardedCoins > 0) {
              onToast(`Earned +${res.awardedCoins} active speaking bonus coins!`);
            }
          })
          .catch(() => {});
      }
    }, 15000);

    return () => {
      stopped = true;
      clearInterval(sampleTimer);
      clearInterval(flushTimer);
      setIsVoiceDetected(false);
      if (audioCtx) void audioCtx.close().catch(() => {});
    };
  }, [activeRoom?.id, activeRoom?.status, isOnStage, myParticipant?.isMuted, currentUser.uid, levelConfig]);

  // Genuine Live Hosting Bonus Heartbeat (Owner-configured per-minute/hour rate when room has enough listeners)
  useEffect(() => {
    if (!activeRoom || activeRoom.status !== 'live' || activeRoom.hostId !== currentUser.uid) {
      return;
    }
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void sendHostingRewardHeartbeat({ roomId: activeRoom.id, activeSeconds: 60 })
        .then((res) => {
          if (res.awardedCoins > 0) {
            onToast(`Hosting reward: +${res.awardedCoins} promotional coins earned!`);
          }
        })
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(timer);
  }, [activeRoom?.id, activeRoom?.status, activeRoom?.hostId, currentUser.uid]);

  // Real WebRTC Mesh Signaling between Speakers & Broadcast to Listeners
  useEffect(() => {
    if (!activeRoom || !myParticipant || myParticipant.isBanned) return;

    const getOrCreatePeer = (remoteUid: string) => {
      const existing = peersRef.current.get(remoteUid);
      if (existing && existing.signalingState !== 'closed') return existing;

      const pc = new RTCPeerConnection(RTC_CONFIG);
      if (localStreamRef.current && isOnStage) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          void sendAudioSignal({
            roomId: activeRoom.id,
            fromUid: currentUser.uid,
            toUid: remoteUid,
            type: 'ice',
            payload: JSON.stringify(ev.candidate),
          });
        }
      };

      pc.ontrack = (ev) => {
        const remoteStream = ev.streams[0];
        if (!remoteStream) return;
        let audioEl = audioElsRef.current.get(remoteUid);
        if (!audioEl) {
          audioEl = new Audio();
          audioEl.autoplay = true;
          audioElsRef.current.set(remoteUid, audioEl);
        }
        audioEl.srcObject = remoteStream;
        void audioEl.play().catch(() => {});
        setRtcStatus('Connected live audio');
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
          setRtcStatus('Reconnecting audio...');
          pc.restartIce();
        } else if (pc.iceConnectionState === 'connected') {
          setRtcStatus('Connected live audio');
        }
      };

      peersRef.current.set(remoteUid, pc);
      return pc;
    };

    const unsubSignals = subscribeAudioSignals(activeRoom.id, currentUser.uid, async (sig) => {
      try {
        const pc = getOrCreatePeer(sig.fromUid);
        if (sig.type === 'offer') {
          await pc.setRemoteDescription(JSON.parse(sig.payload));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendAudioSignal({
            roomId: activeRoom.id,
            fromUid: currentUser.uid,
            toUid: sig.fromUid,
            type: 'answer',
            payload: JSON.stringify(answer),
          });
        } else if (sig.type === 'answer') {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(JSON.parse(sig.payload));
          }
        } else if (sig.type === 'ice') {
          await pc.addIceCandidate(JSON.parse(sig.payload));
        }
      } catch {
        // Ignore transient WebRTC negotiation race
      }
    });

    // Initiators: if I am on stage, initiate audio offers to speakers with higher UID AND listeners
    const activeOthers = participants.filter(
      (p) => !p.isBanned && p.userId !== currentUser.uid && !blockedIds.has(p.userId)
    );
    if (isOnStage && localStreamRef.current) {
      activeOthers.forEach(async (peer) => {
        const peerIsSpeaker = peer.seatNumber >= 1;
        const shouldInitiate = !peerIsSpeaker || currentUser.uid < peer.userId;
        if (!shouldInitiate) return;
        if (peersRef.current.has(peer.userId)) return;
        try {
          const pc = getOrCreatePeer(peer.userId);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await sendAudioSignal({
            roomId: activeRoom.id,
            fromUid: currentUser.uid,
            toUid: peer.userId,
            type: 'offer',
            payload: JSON.stringify(offer),
          });
        } catch {
          // Retry on next participant snapshot if needed
        }
      });
    }

    return () => {
      unsubSignals();
    };
  }, [activeRoom?.id, isOnStage, participants.map((p) => `${p.userId}:${p.seatNumber}`).join(',')]);

  const handleEnterRoom = async (room: AudioRoom) => {
    if (
      room.vipOnly &&
      levelConfig.enableVipRoomAccess &&
      room.hostId !== currentUser.uid &&
      !myLevelSummary.isVip
    ) {
      onToast(
        `VIP Room Locked: Reach Level 5 VIP (${levelConfig.levels[4]?.minHours || 100}h speaking this month) to enter.`
      );
      return;
    }
    try {
      await joinAudioRoom(room, currentUser);
      setActiveRoomId(room.id);
      const defaultTarget = room.speakerIds.find((id) => id !== currentUser.uid) || '';
      setGiftTargetUid(defaultTarget);
      if (myLevelSummary.isVip && levelConfig.enableVipEntryAnimation) {
        void sendAudioRoomMessage({
          roomId: room.id,
          sender: currentUser,
          kind: 'vip_entry',
          text: `👑 VIP ${currentUser.displayName} arrived in the Audio Party!`,
        }).catch(() => {});
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to join room');
    }
  };

  const handleVerifyPrivateJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!privatePromptRoom) return;
    const hashed = await hashRoomPasscode(privatePromptRoom.id, privatePassInput);
    if (hashed !== privatePromptRoom.passcodeHash) {
      onToast('Incorrect private room passcode.');
      return;
    }
    const target = privatePromptRoom;
    setPrivatePromptRoom(null);
    setPrivatePassInput('');
    await handleEnterRoom(target);
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || creating) return;
    if (newVisibility === 'private' && !newPasscode.trim()) {
      onToast('Enter a passcode for your private audio room.');
      return;
    }
    setCreating(true);
    try {
      const room = await createAudioRoom({
        host: currentUser,
        title: newTitle,
        topic: newTopic,
        visibility: newVisibility,
        vipOnly: newVipOnly,
        rawPasscode: newPasscode,
      });
      setShowCreate(false);
      setNewTitle('');
      setNewPasscode('');
      setNewVipOnly(false);
      setActiveRoomId(room.id);
      onToast('BANDHU MELA Audio Party started!');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not create audio room');
    } finally {
      setCreating(false);
    }
  };

  const handleLeave = async () => {
    if (!activeRoom) return;
    cleanupWebRTC();
    await leaveAudioRoom(activeRoom, currentUser.uid);
    setActiveRoomId(null);
  };

  const handleEndRoom = async () => {
    if (!activeRoom) return;
    cleanupWebRTC();
    await endAudioRoom(activeRoom.id);
    setActiveRoomId(null);
    onToast('Audio Party ended for everyone.');
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoom || !chatText.trim()) return;
    try {
      await sendAudioRoomMessage({
        roomId: activeRoom.id,
        sender: currentUser,
        kind: 'chat',
        text: chatText,
      });
      setChatText('');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to send message');
    }
  };

  const handleSendGift = async (gift: VirtualGift) => {
    if (sendingGiftId !== null) return;
    if (!activeRoom || !allowVirtualGifts) {
      onToast('Virtual gifts are currently disabled.');
      return;
    }
    const eligibleRecipients =
      otherSpeakers.length > 0
        ? otherSpeakers
        : activeParticipants.filter((p) => p.userId !== currentUser.uid);
    const chosen =
      eligibleRecipients.find((p) => p.userId === giftTargetUid) || eligibleRecipients[0];
    if (!chosen) {
      onToast('Invite another speaker or listener into the room to send them a gift!');
      return;
    }
    setSendingGiftId(gift.id);
    try {
      const txResult = await sendVirtualGift({
        room: activeRoom,
        sender: currentUser,
        recipient: { uid: chosen.userId, displayName: chosen.displayName },
        gift,
      });
      // Play ONLY after backend Firestore transaction confirms coin deduction & gift delivery
      enqueueConfirmedGift({
        id: txResult.eventId,
        roomId: activeRoom.id,
        roomTitle: activeRoom.title,
        senderId: currentUser.uid,
        senderName: currentUser.displayName,
        senderPhoto: currentUser.photoURL,
        recipientId: chosen.userId,
        recipientName: chosen.displayName,
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

  const activeParticipants = participants.filter((p) => !p.isBanned && !blockedIds.has(p.userId));
  const stageParticipants = [1, 2, 3, 4, 5].map((seat) =>
    activeParticipants.find((p) => p.seatNumber === seat) || null
  );
  const occupiedSeats = activeParticipants
    .filter((p) => p.seatNumber >= 1 && p.seatNumber <= 5)
    .map((p) => p.seatNumber);
  const listeners = activeParticipants.filter((p) => p.seatNumber === 0);
  const raisedHands = listeners.filter((p) => p.handRaised);
  const otherSpeakers = activeParticipants.filter(
    (p) => p.seatNumber >= 1 && p.userId !== currentUser.uid
  );
  const giftRecipients =
    otherSpeakers.length > 0
      ? otherSpeakers
      : activeParticipants.filter((p) => p.userId !== currentUser.uid);

  // ---------------- LIVE ROOM VIEW ----------------
  if (activeRoom) {
    return (
      <div className="space-y-5">
        <GiftAnimationOverlay
          activeGift={activeGiftBanner}
          onClose={() => {
            if (giftTimerRef.current) {
              clearTimeout(giftTimerRef.current);
              giftTimerRef.current = null;
            }
            activeGiftIdRef.current = null;
            setActiveGiftBanner(null);
            playNextQueuedGift();
          }}
        />

        {/* VIP Grand Entry Animation Banner */}
        {vipEntryBanner && levelConfig.enableVipEntryAnimation && (
          <div className="rounded-3xl bg-gradient-to-r from-amber-400 via-amber-500 to-teal-600 text-zinc-950 px-5 py-3.5 flex items-center justify-between gap-3 shadow-lg animate-pulse">
            <div className="flex items-center gap-2.5">
              <Crown className="w-5 h-5" />
              <span className="font-display text-sm font-bold">
                VIP Entrance: {vipEntryBanner.senderName} joined the courtyard! 👑✨
              </span>
            </div>
          </div>
        )}

        {/* Invited to Speak Banner */}
        {myParticipant?.invitedToSpeak && !isOnStage && (
          <div className="rounded-3xl bg-amber-500 text-zinc-950 p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg">
            <div>
              <p className="font-display text-sm font-bold">
                You are invited to join the 5-Seat Stage!
              </p>
              <p className="text-xs opacity-85">
                Accept to turn on your microphone and speak live with the room.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const seat = await acceptSpeakerInvite(activeRoom, currentUser.uid, occupiedSeats);
                    onToast(`Joined Speaker Seat #${seat}`);
                  } catch (err) {
                    onToast(err instanceof Error ? err.message : 'Stage is full');
                  }
                }}
                className="h-10 px-4 rounded-xl bg-zinc-950 text-white text-xs font-bold cursor-pointer"
              >
                Accept Seat
              </button>
              <button
                type="button"
                onClick={() => inviteToSpeak(activeRoom.id, currentUser.uid, false)}
                className="h-10 px-3 rounded-xl bg-white/40 text-xs font-semibold cursor-pointer"
              >
                Stay Listener
              </button>
            </div>
          </div>
        )}

        {/* Room Pavilion Header */}
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span className="text-[#0D6E6E] dark:text-teal-400">{activeRoom.topic}</span>
              <span className="text-zinc-400">·</span>
              <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
                {activeRoom.visibility === 'private' ? (
                  <Lock className="w-3.5 h-3.5 text-amber-500" />
                ) : (
                  <AudioLines className="w-3.5 h-3.5 text-emerald-500" />
                )}
                <span>{activeRoom.visibility === 'private' ? 'Private Room' : 'Public Party'}</span>
              </span>
              {activeRoom.vipOnly && (
                <>
                  <span className="text-zinc-400">·</span>
                  <span className="text-amber-600 dark:text-amber-400 font-bold">👑 VIP Only</span>
                </>
              )}
              <span className="text-zinc-400">·</span>
              <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
                {activeParticipants.length} in room
              </span>
              <span className="text-zinc-400">·</span>
              <span className="text-zinc-500">
                {isVoiceDetected ? '🎙️ Counting active voice' : rtcStatus}
              </span>
            </div>
            <h1 className="font-display text-xl font-bold mt-1 truncate">{activeRoom.title}</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenWallet}
              className="h-10 px-3.5 rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Coins className="w-4 h-4" />
              <span className="tabular-nums">{wallet?.coinsBalance ?? 0} Coins</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                const url = `${window.location.origin}/?room=${activeRoom.id}`;
                await navigator.clipboard.writeText(url);
                onToast('Audio Party invite link copied!');
              }}
              className="h-10 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
              <span>Share</span>
            </button>
            {activeRoom.hostId === currentUser.uid ? (
              <button
                type="button"
                onClick={handleEndRoom}
                className="h-10 px-4 rounded-xl bg-red-600 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <PhoneOff className="w-4 h-4" />
                <span>End Room</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLeave}
                className="h-10 px-4 rounded-xl border border-red-300 dark:border-red-900 text-red-600 text-xs font-semibold cursor-pointer"
              >
                Leave Quietly
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Left 7 cols: Original 5-Seat Courtyard Stage + Listeners */}
          <div className="xl:col-span-7 space-y-5">
            {/* 5-Seat Speaker Mandap */}
            <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display text-sm font-bold">
                    Courtyard Stage (5 Speaker Seats)
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Up to 5 speakers talk live together · <span className="tabular-nums">{activeRoom.giftsCoinsTotal}</span> gift coins shared
                  </p>
                </div>
                {isOnStage && myParticipant && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        toggleParticipantMute(activeRoom.id, currentUser.uid, myParticipant.isMuted)
                      }
                      className={`h-10 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                        myParticipant.isMuted
                          ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200'
                          : 'bg-[#0D6E6E] text-white'
                      }`}
                    >
                      {myParticipant.isMuted ? (
                        <MicOff className="w-4 h-4" />
                      ) : (
                        <Mic className="w-4 h-4" />
                      )}
                      <span>{myParticipant.isMuted ? 'Unmute Mic' : 'Mic Live'}</span>
                    </button>
                    {activeRoom.hostId !== currentUser.uid && (
                      <button
                        type="button"
                        onClick={() => moveSpeakerToListener(activeRoom, currentUser.uid)}
                        className="h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold cursor-pointer"
                      >
                        Step Down
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* 5-Seat Mandap Grid (2 top host/co-host seats + 3 lower seats — original geometric pavilion) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {stageParticipants.map((occupant, index) => {
                  const seatNo = index + 1;
                  if (!occupant) {
                    return (
                      <div
                        key={seatNo}
                        className="rounded-2xl border-2 border-dashed border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0]/50 dark:bg-[#0E1113]/50 p-3 flex flex-col items-center justify-center text-center min-h-[146px] gap-1.5"
                      >
                        <div className="w-11 h-11 rounded-2xl bg-[#E4DFD5]/60 dark:bg-[#262C30] flex items-center justify-center text-zinc-400">
                          <Mic className="w-4 h-4" />
                        </div>
                        <p className="text-xs font-semibold text-zinc-500">Seat #{seatNo}</p>
                        <p className="text-[11px] text-zinc-400">Open for speaker</p>
                      </div>
                    );
                  }

                  const isSeatHost = occupant.userId === activeRoom.hostId;
                  const isSeatMod = activeRoom.moderatorIds.includes(occupant.userId);
                  const occSummary = computeLevelSummary(speakingStatsMap[occupant.userId], levelConfig);
                  const showVipFrame = occSummary.isVip && levelConfig.enableVipFrames;
                  const showVipColor = occSummary.isVip && levelConfig.enableVipNameColors;
                  return (
                    <div
                      key={occupant.userId}
                      className={`relative rounded-2xl border p-3 flex flex-col items-center text-center min-h-[146px] justify-between transition-colors ${
                        !occupant.isMuted
                          ? 'border-[#0D6E6E] bg-[#0D6E6E]/5 dark:bg-teal-950/20'
                          : 'border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0]/40 dark:bg-[#0E1113]/40'
                      }`}
                    >
                      <div className="w-full flex items-center justify-between text-[10px] font-bold">
                        <span className="text-zinc-400">#{seatNo}</span>
                        {isSeatHost ? (
                          <Crown className="w-3.5 h-3.5 text-amber-500" />
                        ) : isSeatMod ? (
                          <Shield className="w-3.5 h-3.5 text-[#0D6E6E]" />
                        ) : (
                          <span />
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => onSelectUser(occupant.userId)}
                        className="relative cursor-pointer"
                      >
                        <Avatar
                          src={occupant.photoURL}
                          name={occupant.displayName}
                          size="md"
                          isVip={showVipFrame}
                        />
                        <span
                          className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-white ${
                            occupant.isMuted ? 'bg-zinc-500' : 'bg-[#0D6E6E]'
                          }`}
                        >
                          {occupant.isMuted ? (
                            <MicOff className="w-3 h-3" />
                          ) : (
                            <Mic className="w-3 h-3" />
                          )}
                        </span>
                      </button>

                      <div className="w-full min-w-0">
                        <p
                          className={`text-xs font-semibold truncate flex items-center justify-center gap-1 ${
                            showVipColor ? 'text-amber-600 dark:text-amber-400 font-bold' : ''
                          }`}
                        >
                          <span className="truncate">{occupant.displayName}</span>
                          {verifiedUserIds.has(occupant.userId) && (
                            <VerifiedBadge className="w-3 h-3 shrink-0" />
                          )}
                        </p>
                        <div className="flex items-center justify-center gap-1 mt-0.5">
                          <span className="text-[10px] text-zinc-500">
                            {isSeatHost ? 'Host' : isSeatMod ? 'Mod' : 'Speaker'}
                          </span>
                          <LevelBadge stats={speakingStatsMap[occupant.userId]} config={levelConfig} compact />
                        </div>
                      </div>

                      {/* Host / Mod Controls on other speakers */}
                      {isHostOrMod && occupant.userId !== currentUser.uid && !isSeatHost && (
                        <div className="flex items-center justify-center gap-1 pt-1">
                          <button
                            type="button"
                            onClick={() =>
                              toggleParticipantMute(activeRoom.id, occupant.userId, occupant.isMuted)
                            }
                            title={occupant.isMuted ? 'Allow Unmute' : 'Mute Speaker'}
                            className="w-7 h-7 rounded-lg bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-center cursor-pointer"
                          >
                            {occupant.isMuted ? (
                              <Mic className="w-3 h-3 text-[#0D6E6E]" />
                            ) : (
                              <MicOff className="w-3 h-3 text-amber-600" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSpeakerToListener(activeRoom, occupant.userId)}
                            title="Move to Listener"
                            className="w-7 h-7 rounded-lg bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-center cursor-pointer"
                          >
                            <UserMinus className="w-3 h-3" />
                          </button>
                          {activeRoom.hostId === currentUser.uid && (
                            <button
                              type="button"
                              onClick={() =>
                                toggleRoomModerator(activeRoom, occupant.userId, !isSeatMod)
                              }
                              title={isSeatMod ? 'Remove Moderator' : 'Make Moderator'}
                              className="w-7 h-7 rounded-lg bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-center cursor-pointer"
                            >
                              <Shield className={`w-3 h-3 ${isSeatMod ? 'text-[#0D6E6E]' : ''}`} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => banAudioParticipant(activeRoom, occupant.userId)}
                            title="Remove & Ban"
                            className="w-7 h-7 rounded-lg bg-white dark:bg-[#171B1E] border border-red-200 dark:border-red-900 text-red-600 flex items-center justify-center cursor-pointer"
                          >
                            <Ban className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Listener Raise Hand & Reaction Strip */}
              <div className="pt-3 border-t border-[#E4DFD5] dark:border-[#262C30] flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() =>
                        sendAudioRoomMessage({
                          roomId: activeRoom.id,
                          sender: currentUser,
                          kind: 'reaction',
                          text: emoji,
                        })
                      }
                      className="w-9 h-9 rounded-xl bg-[#F7F5F0] dark:bg-[#0E1113] hover:scale-110 transition-transform text-base cursor-pointer"
                    >
                      {emoji}
                    </button>
                  ))}
                  {myLevelSummary.isVip &&
                    levelConfig.enableVipExclusiveEmojis &&
                    VIP_EXCLUSIVE_EMOJIS.map((emoji) => (
                      <button
                        key={`vip_${emoji}`}
                        type="button"
                        title="VIP Exclusive Emoji"
                        onClick={() =>
                          sendAudioRoomMessage({
                            roomId: activeRoom.id,
                            sender: currentUser,
                            kind: 'reaction',
                            text: `${emoji} (VIP)`,
                          })
                        }
                        className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-400/50 hover:scale-110 transition-transform text-base cursor-pointer"
                      >
                        {emoji}
                      </button>
                    ))}
                </div>

                {!isOnStage && myParticipant && (
                  <button
                    type="button"
                    onClick={() =>
                      toggleRaiseHand(activeRoom.id, currentUser.uid, myParticipant.handRaised)
                    }
                    className={`h-10 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                      myParticipant.handRaised
                        ? 'bg-amber-500 text-zinc-950'
                        : 'border border-[#E4DFD5] dark:border-[#262C30]'
                    }`}
                  >
                    <Hand className="w-4 h-4" />
                    <span>{myParticipant.handRaised ? 'Hand Raised' : 'Raise Hand'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Raise Hand Queue & Unlimited Listeners Courtyard */}
            <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold flex items-center gap-2">
                  <Headphones className="w-4 h-4 text-[#0D6E6E]" />
                  <span>Listeners ({listeners.length})</span>
                </h3>
                {raisedHands.length > 0 && (
                  <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                    {raisedHands.length} raised hand
                  </span>
                )}
              </div>

              {listeners.length === 0 ? (
                <p className="text-xs text-zinc-500 py-2">
                  Share the room link to invite unlimited listeners!
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {listeners.map((listener) => (
                    <div
                      key={listener.userId}
                      className="rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] p-3 flex items-center justify-between gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => onSelectUser(listener.userId)}
                        className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
                      >
                        <Avatar src={listener.photoURL} name={listener.displayName} size="sm" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate flex items-center gap-1">
                            <span className="truncate">{listener.displayName}</span>
                            {listener.handRaised && <span title="Raised Hand">✋</span>}
                          </p>
                          <p className="text-[11px] text-zinc-500 truncate">@{listener.username}</p>
                        </div>
                      </button>

                      {isHostOrMod && listener.userId !== currentUser.uid && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={occupiedSeats.length >= 5}
                            onClick={async () => {
                              try {
                                await inviteToSpeak(activeRoom.id, listener.userId, true);
                                onToast(`Invited ${listener.displayName} to stage`);
                              } catch (err) {
                                onToast(err instanceof Error ? err.message : 'Unable to invite');
                              }
                            }}
                            className="h-8 px-2.5 rounded-lg bg-[#0D6E6E]/10 text-[#0D6E6E] dark:text-teal-300 text-[11px] font-semibold cursor-pointer disabled:opacity-40"
                          >
                            Invite
                          </button>
                          <button
                            type="button"
                            disabled={occupiedSeats.length >= 5}
                            onClick={async () => {
                              try {
                                const seat = await assignSpeakerSeatMod(
                                  activeRoom,
                                  listener.userId,
                                  occupiedSeats
                                );
                                onToast(`${listener.displayName} moved to Seat #${seat}`);
                              } catch (err) {
                                onToast(err instanceof Error ? err.message : 'Stage is full');
                              }
                            }}
                            title="Seat directly"
                            className="w-8 h-8 rounded-lg border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-center cursor-pointer disabled:opacity-40"
                          >
                            <UserCheck className="w-3.5 h-3.5 text-[#0D6E6E]" />
                          </button>
                          <button
                            type="button"
                            onClick={() => banAudioParticipant(activeRoom, listener.userId)}
                            title="Remove & Ban"
                            className="w-8 h-8 rounded-lg border border-red-200 dark:border-red-900 text-red-600 flex items-center justify-center cursor-pointer"
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right 5 cols: Virtual Gifts Tray & Live Room Chat */}
          <div className="xl:col-span-5 space-y-5">
            {/* Virtual Gift Sender Card */}
            {allowVirtualGifts && (
              <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold flex items-center gap-1.5">
                    <Gift className="w-4 h-4 text-amber-500" />
                    <span>Send Animated Virtual Gift</span>
                  </h3>
                  <button
                    type="button"
                    onClick={onOpenWallet}
                    className="text-xs font-bold text-amber-600 dark:text-amber-400 cursor-pointer"
                  >
                    + Get Coins
                  </button>
                </div>

                {giftRecipients.length > 0 ? (
                  <select
                    value={giftTargetUid || giftRecipients[0].userId}
                    onChange={(e) => setGiftTargetUid(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs font-medium"
                  >
                    {giftRecipients.map((sp) => (
                      <option key={sp.userId} value={sp.userId}>
                        {sp.seatNumber >= 1 ? `To Seat #${sp.seatNumber}` : 'To Listener'}: {sp.displayName} (@{sp.username})
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-zinc-500">
                    Waiting for another speaker or listener in the room to receive gifts.
                  </p>
                )}

                <div className="grid grid-cols-4 sm:grid-cols-4 gap-2">
                  {gifts
                    .filter((g) => g.active)
                    .map((gift) => {
                      const isCouple =
                        gift.id === 'gift_love_couple' || gift.animationType === 'couple_love';
                      return (
                        <button
                          key={gift.id}
                          type="button"
                          disabled={sendingGiftId !== null || giftRecipients.length === 0}
                          onClick={() => handleSendGift(gift)}
                          className={`rounded-2xl border p-2 flex flex-col items-center gap-0.5 cursor-pointer disabled:opacity-45 transition-colors ${
                            isCouple
                              ? 'border-rose-400/70 bg-gradient-to-b from-rose-500/15 via-amber-500/10 to-transparent hover:border-amber-400'
                              : 'border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0]/60 dark:bg-[#0E1113]/60 hover:border-amber-500'
                          }`}
                        >
                          <span className="text-2xl">{gift.emoji}</span>
                          <span className="text-[11px] font-semibold truncate w-full text-center">
                            {gift.name}
                          </span>
                          <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                            {sendingGiftId === gift.id ? 'Sending...' : `${gift.coinPrice}c`}
                          </span>
                        </button>
                      );
                    })}
                </div>

                {roomGiftEvents.length > 0 && (
                  <p className="text-[11px] text-zinc-500 truncate">
                    Latest gift: {roomGiftEvents[0].giftEmoji} {roomGiftEvents[0].senderName} →{' '}
                    {roomGiftEvents[0].recipientName}
                  </p>
                )}
              </div>
            )}

            {/* Live Room Chat */}
            <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden flex flex-col h-[390px]">
              <div className="px-5 py-3.5 border-b border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between">
                <h3 className="font-display text-sm font-bold">Room Adda Chat</h3>
                <span className="text-xs text-zinc-500 tabular-nums">{messages.length}</span>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {messages.length === 0 ? (
                  <p className="text-xs text-zinc-500 text-center py-10">
                    Say hello or drop a live reaction in the room!
                  </p>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`text-xs rounded-2xl px-3 py-2 ${
                        msg.kind === 'gift'
                          ? 'bg-amber-500/15 border border-amber-400/40'
                          : msg.kind === 'reaction'
                          ? 'bg-[#0D6E6E]/10'
                          : 'bg-[#F7F5F0] dark:bg-[#0E1113]'
                      }`}
                    >
                      <span className="font-bold text-[#0D6E6E] dark:text-teal-400">
                        {msg.senderName}
                      </span>{' '}
                      {msg.kind === 'gift' ? (
                        <span className="font-semibold">
                          {msg.giftEmoji} {msg.text}
                        </span>
                      ) : (
                        <span className="text-zinc-800 dark:text-zinc-200">{msg.text}</span>
                      )}
                    </div>
                  ))
                )}
              </div>

              <form
                onSubmit={handleSendChat}
                className="p-3 border-t border-[#E4DFD5] dark:border-[#262C30] flex items-center gap-2"
              >
                <input
                  type="text"
                  maxLength={350}
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  placeholder="Write a message in the party..."
                  className="flex-1 h-10 px-3.5 rounded-xl bg-[#F7F5F0] dark:bg-[#0E1113] text-xs focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!chatText.trim()}
                  className="w-10 h-10 rounded-xl bg-[#0D6E6E] text-white flex items-center justify-center cursor-pointer disabled:opacity-40"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- AUDIO PARTY LOBBY ----------------
  return (
    <div className="space-y-6">
      {/* Original Adda Mandap Hero Card */}
      <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#0D6E6E] text-white flex items-center justify-center shrink-0">
            <AudioLines className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold">BANDHU MELA Audio Party</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              5 simultaneous speaker seats · Unlimited listeners · Animated virtual gifts &amp; WebRTC audio
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenWallet}
            className="h-11 px-4 rounded-2xl bg-amber-500/15 text-amber-700 dark:text-amber-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Coins className="w-4 h-4" />
            <span className="tabular-nums">{wallet?.coinsBalance ?? 0} Coins</span>
          </button>
          {allowAudioRooms && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="h-11 px-5 rounded-2xl bg-[#0D6E6E] hover:bg-[#095454] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Start Audio Party</span>
            </button>
          )}
        </div>
      </div>

      {!allowAudioRooms && (
        <div className="rounded-3xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-5 text-xs font-semibold text-amber-800 dark:text-amber-300">
          Creating new Audio Party rooms is currently paused by the Platform Owner.
        </div>
      )}

      {rooms.length === 0 ? (
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-12 text-center space-y-3">
          <Sparkles className="w-10 h-10 mx-auto text-[#0D6E6E]" />
          <h2 className="font-display text-lg font-bold">No Live Audio Parties Right Now</h2>
          <p className="text-sm text-zinc-500 max-w-md mx-auto">
            Start a public or private courtyard room with 5 speaker seats, raise-hand queue, live reactions, and animated virtual gifts!
          </p>
          {allowAudioRooms && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="h-11 px-6 rounded-xl bg-[#0D6E6E] text-white text-sm font-semibold cursor-pointer"
            >
              Launch First Audio Party
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rooms.map((room) => (
            <div
              key={room.id}
              className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 flex flex-col justify-between gap-4 hover:border-[#0D6E6E] transition-colors"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-[#0D6E6E] dark:text-teal-400">{room.topic}</span>
                  <span className="flex items-center gap-1 text-zinc-500">
                    {room.visibility === 'private' ? (
                      <>
                        <Lock className="w-3.5 h-3.5 text-amber-500" />
                        <span>Private</span>
                      </>
                    ) : (
                      <>
                        <Users className="w-3.5 h-3.5 text-emerald-500" />
                        <span className="tabular-nums">{room.participantsCount} live</span>
                      </>
                    )}
                  </span>
                </div>

                <h3 className="font-display text-lg font-bold leading-snug">{room.title}</h3>

                <div className="flex items-center gap-2.5 pt-1">
                  <Avatar src={room.hostPhoto} name={room.hostName} size="sm" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">Hosted by {room.hostName}</p>
                    <p className="text-[11px] text-zinc-500">
                      <span className="tabular-nums">{room.speakerIds.length}/5</span> seats occupied ·{' '}
                      {formatRelativeTime(room.createdAt)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-3 border-t border-[#E4DFD5] dark:border-[#262C30]">
                <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold tabular-nums">
                  {room.giftsCoinsTotal} gift coins
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (room.visibility === 'private' && room.hostId !== currentUser.uid) {
                      setPrivatePromptRoom(room);
                    } else {
                      void handleEnterRoom(room);
                    }
                  }}
                  className="h-10 px-5 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold cursor-pointer"
                >
                  {room.visibility === 'private' && room.hostId !== currentUser.uid
                    ? 'Enter Passcode'
                    : 'Join Party'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Room Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between">
              <h3 className="font-display text-base font-bold">Start Audio Party Room</h3>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="w-9 h-9 rounded-full flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateRoom} className="p-6 space-y-4">
              <input
                type="text"
                required
                maxLength={120}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Room Title (e.g. Late Night Acoustic Adda)"
                className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
              />

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-500">Topic</label>
                <select
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
                >
                  {ROOM_TOPICS.map((tp) => (
                    <option key={tp} value={tp}>
                      {tp}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {(['public', 'private'] as const).map((vis) => (
                  <button
                    key={vis}
                    type="button"
                    onClick={() => setNewVisibility(vis)}
                    className={`h-11 rounded-xl border text-xs font-semibold capitalize cursor-pointer ${
                      newVisibility === vis
                        ? 'bg-[#0D6E6E] text-white border-[#0D6E6E]'
                        : 'border-[#E4DFD5] dark:border-[#262C30]'
                    }`}
                  >
                    {vis} Room
                  </button>
                ))}
              </div>

              {newVisibility === 'private' && (
                <input
                  type="text"
                  required
                  maxLength={20}
                  value={newPasscode}
                  onChange={(e) => setNewPasscode(e.target.value)}
                  placeholder="Set Secret Room Passcode"
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
                />
              )}

              {levelConfig.enableVipRoomAccess && (
                <label className="flex items-center justify-between rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] px-4 py-3 text-xs font-semibold cursor-pointer">
                  <span>VIP-Only Access (Level 5 VIP &amp; Host)</span>
                  <input
                    type="checkbox"
                    checked={newVipOnly}
                    onChange={(e) => setNewVipOnly(e.target.checked)}
                    className="w-4 h-4 accent-[#0D6E6E]"
                  />
                </label>
              )}

              <button
                type="submit"
                disabled={creating}
                className="w-full h-11 rounded-xl bg-[#0D6E6E] text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
              >
                {creating ? 'Opening Room...' : 'Open 5-Seat Stage'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Private Passcode Modal */}
      {privatePromptRoom && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold">Private Audio Party</h3>
              <button
                type="button"
                onClick={() => setPrivatePromptRoom(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              Enter the room passcode shared by {privatePromptRoom.hostName} to join{' '}
              <strong>{privatePromptRoom.title}</strong>.
            </p>
            <form onSubmit={handleVerifyPrivateJoin} className="space-y-3">
              <input
                type="password"
                required
                value={privatePassInput}
                onChange={(e) => setPrivatePassInput(e.target.value)}
                placeholder="Room passcode"
                className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
              />
              <button
                type="submit"
                className="w-full h-11 rounded-xl bg-[#0D6E6E] text-white text-sm font-semibold cursor-pointer"
              >
                Unlock &amp; Join
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
