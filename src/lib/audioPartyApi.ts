import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  AudioRoom,
  AudioRoomMessage,
  AudioRoomParticipant,
  AuditLogEntry,
  CoinPackage,
  CoinTopupRequest,
  CoinTransaction,
  GiftEvent,
  UserProfile,
  UserWallet,
  VirtualGift,
  WebRTCSignal,
} from '../types/social';
import { db, handleFirestoreError, OperationType } from './firebase';
import { checkSpamGuard, makeId, toMillis } from './socialApi';

export const DEFAULT_VIRTUAL_GIFTS: Omit<VirtualGift, 'createdAt' | 'updatedAt'>[] = [
  { id: 'gift_rose', name: 'Bengal Rose', emoji: '🌹', category: 'classic', coinPrice: 10, animationType: 'float', active: true },
  { id: 'gift_chai', name: 'Kulhad Chai', emoji: '🍵', category: 'classic', coinPrice: 15, animationType: 'float', active: true },
  { id: 'gift_heart', name: 'Warm Heart', emoji: '💖', category: 'classic', coinPrice: 25, animationType: 'burst', active: true },
  { id: 'gift_teddy', name: 'Teddy Hug', emoji: '🧸', category: 'celebration', coinPrice: 60, animationType: 'burst', active: true },
  { id: 'gift_diya', name: 'Festive Diya', emoji: '🪔', category: 'celebration', coinPrice: 100, animationType: 'sparkle', active: true },
  { id: 'gift_crown', name: 'Royal Crown', emoji: '👑', category: 'royal', coinPrice: 250, animationType: 'crown', active: true },
  { id: 'gift_diamond', name: 'Star Diamond', emoji: '💎', category: 'royal', coinPrice: 500, animationType: 'sparkle', active: true },
  { id: 'gift_love_couple', name: 'Love Couple Gift', emoji: '❤️', category: 'royal', coinPrice: 500, animationType: 'couple_love', active: true },
];

export const LEGACY_COIN_PACKAGE_IDS = ['pkg_starter', 'pkg_festive', 'pkg_royal', 'pkg_legend'] as const;

export const DEFAULT_COIN_PACKAGES: Omit<CoinPackage, 'createdAt' | 'updatedAt'>[] = [
  { id: 'pkg_100', name: '100 Coins Pack', coins: 100, bonusCoins: 0, priceUsd: 0.12, priceInr: 10, active: true },
  { id: 'pkg_500', name: '500 Coins Pack', coins: 500, bonusCoins: 0, priceUsd: 0.59, priceInr: 49, active: true },
  { id: 'pkg_1000', name: '1,000 Coins Pack', coins: 1000, bonusCoins: 0, priceUsd: 1.19, priceInr: 99, active: true },
  { id: 'pkg_5000', name: '5,000 Coins Pack', coins: 5000, bonusCoins: 0, priceUsd: 4.79, priceInr: 399, active: true },
  { id: 'pkg_10000', name: '10,000 Coins Pack', coins: 10000, bonusCoins: 0, priceUsd: 9.59, priceInr: 799, active: true },
];

export async function hashRoomPasscode(roomId: string, rawCode: string): Promise<string> {
  const input = `${roomId}:${rawCode.trim()}`;
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------- AUDIT LOGGING ----------------
export async function logAdminAction(params: {
  actor: UserProfile;
  actorRole: 'owner' | 'admin' | 'moderator';
  action: string;
  targetType: string;
  targetId: string;
  details: string;
}): Promise<void> {
  const logId = makeId('log');
  try {
    await setDoc(doc(db, 'auditLogs', logId), {
      id: logId,
      actorId: params.actor.uid,
      actorName: params.actor.displayName.slice(0, 60),
      actorRole: params.actorRole,
      action: params.action.slice(0, 80),
      targetType: params.targetType.slice(0, 40),
      targetId: params.targetId.slice(0, 128),
      details: params.details.slice(0, 400),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Audit log write warning:', err);
  }
}

export async function fetchAuditLogsOwner(): Promise<AuditLogEntry[]> {
  try {
    const snap = await getDocs(query(collection(db, 'auditLogs'), limit(120)));
    const list = snap.docs.map((d) => d.data() as AuditLogEntry);
    list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'auditLogs');
  }
}

// ---------------- AUDIO PARTY ROOMS ----------------
export function subscribeLiveAudioRooms(onData: (rooms: AudioRoom[]) => void): () => void {
  const q = query(collection(db, 'audioRooms'), where('status', '==', 'live'), limit(50));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as AudioRoom);
      list.sort((a, b) => b.participantsCount - a.participantsCount || toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(list);
    },
    (error) => console.warn('Audio rooms listener warning:', error)
  );
}

export async function fetchAllAudioRoomsAdmin(): Promise<AudioRoom[]> {
  try {
    const snap = await getDocs(query(collection(db, 'audioRooms'), limit(80)));
    const list = snap.docs.map((d) => d.data() as AudioRoom);
    list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'audioRooms');
  }
}

export async function createAudioRoom(params: {
  host: UserProfile;
  title: string;
  topic: string;
  visibility: 'public' | 'private';
  vipOnly?: boolean;
  rawPasscode?: string;
}): Promise<AudioRoom> {
  checkSpamGuard(`audio_room:${params.host.uid}`, `${params.title} ${params.topic}`, 4000);
  const roomId = makeId('aud');
  const passcodeHash =
    params.visibility === 'private' && params.rawPasscode?.trim()
      ? await hashRoomPasscode(roomId, params.rawPasscode)
      : '';

  const room: AudioRoom = {
    id: roomId,
    title: params.title.trim().slice(0, 120),
    topic: params.topic.trim().slice(0, 60) || 'Open Adda',
    visibility: params.visibility,
    vipOnly: Boolean(params.vipOnly),
    passcodeHash,
    hostId: params.host.uid,
    hostName: params.host.displayName.slice(0, 60),
    hostUsername: params.host.username.slice(0, 30),
    hostPhoto: params.host.photoURL.slice(0, 2000),
    moderatorIds: [],
    speakerIds: [params.host.uid],
    status: 'live',
    participantsCount: 1,
    giftsCoinsTotal: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'audioRooms', roomId), room);
    await setDoc(doc(db, 'audioRooms', roomId, 'participants', params.host.uid), {
      userId: params.host.uid,
      roomId,
      displayName: params.host.displayName.slice(0, 60),
      username: params.host.username.slice(0, 30),
      photoURL: params.host.photoURL.slice(0, 2000),
      role: 'host',
      seatNumber: 1,
      isMuted: false,
      handRaised: false,
      invitedToSpeak: false,
      isBanned: false,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return room;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `audioRooms/${roomId}`);
  }
}

export async function joinAudioRoom(room: AudioRoom, user: UserProfile): Promise<AudioRoomParticipant> {
  const partRef = doc(db, 'audioRooms', room.id, 'participants', user.uid);
  const roomRef = doc(db, 'audioRooms', room.id);
  try {
    const existing = await getDoc(partRef);
    if (existing.exists()) {
      const data = existing.data() as AudioRoomParticipant;
      if (data.isBanned) {
        throw new Error('You have been removed or blocked from this audio party room.');
      }
      await updateDoc(partRef, {
        displayName: user.displayName.slice(0, 60),
        photoURL: user.photoURL.slice(0, 2000),
        updatedAt: serverTimestamp(),
      });
      return data;
    }

    const participant: AudioRoomParticipant = {
      userId: user.uid,
      roomId: room.id,
      displayName: user.displayName.slice(0, 60),
      username: user.username.slice(0, 30),
      photoURL: user.photoURL.slice(0, 2000),
      role: room.hostId === user.uid ? 'host' : 'listener',
      seatNumber: room.hostId === user.uid ? 1 : 0,
      isMuted: room.hostId !== user.uid,
      handRaised: false,
      invitedToSpeak: false,
      isBanned: false,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const batch = writeBatch(db);
    batch.set(partRef, participant);
    batch.update(roomRef, {
      participantsCount: increment(1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return participant;
  } catch (error) {
    if (error instanceof Error && error.message.includes('removed or blocked')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `audioRooms/${room.id}/participants/${user.uid}`);
  }
}

export async function leaveAudioRoom(room: AudioRoom, userId: string): Promise<void> {
  const partRef = doc(db, 'audioRooms', room.id, 'participants', userId);
  const roomRef = doc(db, 'audioRooms', room.id);
  try {
    const snap = await getDoc(partRef);
    if (!snap.exists()) return;
    const data = snap.data() as AudioRoomParticipant;
    if (data.isBanned) return;

    const batch = writeBatch(db);
    batch.delete(partRef);
    if (room.participantsCount > 0) {
      batch.update(roomRef, {
        participantsCount: increment(-1),
        updatedAt: serverTimestamp(),
      });
    }
    if (room.speakerIds.includes(userId) && room.hostId !== userId) {
      batch.update(roomRef, {
        speakerIds: room.speakerIds.filter((id) => id !== userId),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch {
    // Non-blocking clean disconnect
  }
}

export async function endAudioRoom(roomId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'audioRooms', roomId), {
      status: 'ended',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `audioRooms/${roomId}`);
  }
}

export async function updateAudioRoomMeta(
  roomId: string,
  updates: { title: string; topic: string; visibility: 'public' | 'private' }
): Promise<void> {
  try {
    await updateDoc(doc(db, 'audioRooms', roomId), {
      title: updates.title.trim().slice(0, 120),
      topic: updates.topic.trim().slice(0, 60),
      visibility: updates.visibility,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `audioRooms/${roomId}`);
  }
}

export function subscribeAudioParticipants(
  roomId: string,
  onData: (participants: AudioRoomParticipant[]) => void
): () => void {
  const q = query(
    collection(db, 'audioRooms', roomId, 'participants'),
    where('roomId', '==', roomId),
    limit(150)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as AudioRoomParticipant);
      list.sort((a, b) => a.seatNumber - b.seatNumber || toMillis(a.joinedAt) - toMillis(b.joinedAt));
      onData(list);
    },
    (error) => console.warn('Audio participants listener warning:', error)
  );
}

export async function toggleRaiseHand(roomId: string, userId: string, handRaised: boolean): Promise<void> {
  await updateDoc(doc(db, 'audioRooms', roomId, 'participants', userId), {
    handRaised: !handRaised,
    updatedAt: serverTimestamp(),
  });
}

export async function toggleParticipantMute(roomId: string, userId: string, isMuted: boolean): Promise<void> {
  await updateDoc(doc(db, 'audioRooms', roomId, 'participants', userId), {
    isMuted: !isMuted,
    updatedAt: serverTimestamp(),
  });
}

export async function inviteToSpeak(roomId: string, targetUid: string, invited: boolean): Promise<void> {
  await updateDoc(doc(db, 'audioRooms', roomId, 'participants', targetUid), {
    invitedToSpeak: invited,
    updatedAt: serverTimestamp(),
  });
}

export async function acceptSpeakerInvite(
  room: AudioRoom,
  userId: string,
  occupiedSeats: number[]
): Promise<number> {
  let freeSeat = 0;
  for (let s = 1; s <= 5; s++) {
    if (!occupiedSeats.includes(s)) {
      freeSeat = s;
      break;
    }
  }
  if (!freeSeat || room.speakerIds.length >= 5) {
    throw new Error('All 5 speaker seats are currently occupied.');
  }
  const nextSpeakers = Array.from(new Set([...room.speakerIds, userId])).slice(0, 5);
  const batch = writeBatch(db);
  batch.update(doc(db, 'audioRooms', room.id, 'participants', userId), {
    role: 'speaker',
    seatNumber: freeSeat,
    invitedToSpeak: false,
    handRaised: false,
    isMuted: false,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'audioRooms', room.id), {
    speakerIds: nextSpeakers,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return freeSeat;
}

export async function assignSpeakerSeatMod(
  room: AudioRoom,
  targetUid: string,
  occupiedSeats: number[]
): Promise<number> {
  let freeSeat = 0;
  for (let s = 1; s <= 5; s++) {
    if (!occupiedSeats.includes(s)) {
      freeSeat = s;
      break;
    }
  }
  if (!freeSeat || room.speakerIds.length >= 5) {
    throw new Error('All 5 speaker seats are occupied.');
  }
  const nextSpeakers = Array.from(new Set([...room.speakerIds, targetUid])).slice(0, 5);
  const batch = writeBatch(db);
  batch.update(doc(db, 'audioRooms', room.id, 'participants', targetUid), {
    role: room.moderatorIds.includes(targetUid) ? 'moderator' : 'speaker',
    seatNumber: freeSeat,
    invitedToSpeak: false,
    handRaised: false,
    isMuted: false,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'audioRooms', room.id), {
    speakerIds: nextSpeakers,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return freeSeat;
}

export async function moveSpeakerToListener(room: AudioRoom, targetUid: string): Promise<void> {
  const nextSpeakers = room.speakerIds.filter((id) => id !== targetUid);
  const batch = writeBatch(db);
  batch.update(doc(db, 'audioRooms', room.id, 'participants', targetUid), {
    role: room.moderatorIds.includes(targetUid) ? 'moderator' : 'listener',
    seatNumber: 0,
    isMuted: true,
    invitedToSpeak: false,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'audioRooms', room.id), {
    speakerIds: nextSpeakers,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function toggleRoomModerator(room: AudioRoom, targetUid: string, makeMod: boolean): Promise<void> {
  const nextMods = makeMod
    ? Array.from(new Set([...room.moderatorIds, targetUid])).slice(0, 10)
    : room.moderatorIds.filter((id) => id !== targetUid);
  const batch = writeBatch(db);
  batch.update(doc(db, 'audioRooms', room.id), {
    moderatorIds: nextMods,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'audioRooms', room.id, 'participants', targetUid), {
    role: makeMod ? 'moderator' : room.speakerIds.includes(targetUid) ? 'speaker' : 'listener',
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function banAudioParticipant(room: AudioRoom, targetUid: string): Promise<void> {
  const nextSpeakers = room.speakerIds.filter((id) => id !== targetUid);
  const nextMods = room.moderatorIds.filter((id) => id !== targetUid);
  const batch = writeBatch(db);
  batch.update(doc(db, 'audioRooms', room.id, 'participants', targetUid), {
    isBanned: true,
    role: 'listener',
    seatNumber: 0,
    isMuted: true,
    handRaised: false,
    invitedToSpeak: false,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'audioRooms', room.id), {
    speakerIds: nextSpeakers,
    moderatorIds: nextMods,
    participantsCount: room.participantsCount > 0 ? increment(-1) : 0,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function unbanAudioParticipant(roomId: string, targetUid: string): Promise<void> {
  await deleteDoc(doc(db, 'audioRooms', roomId, 'participants', targetUid));
}

export function subscribeAudioMessages(
  roomId: string,
  onData: (messages: AudioRoomMessage[]) => void
): () => void {
  const q = query(
    collection(db, 'audioRooms', roomId, 'messages'),
    where('roomId', '==', roomId),
    limit(120)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as AudioRoomMessage);
      list.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
      onData(list);
    },
    (error) => console.warn('Audio chat warning:', error)
  );
}

export async function sendAudioRoomMessage(params: {
  roomId: string;
  sender: UserProfile;
  kind: AudioRoomMessage['kind'];
  text: string;
}): Promise<void> {
  if (params.kind === 'chat') {
    checkSpamGuard(`aud_chat:${params.sender.uid}`, params.text, 1000);
  }
  const msgId = makeId('amsg');
  await setDoc(doc(db, 'audioRooms', params.roomId, 'messages', msgId), {
    id: msgId,
    roomId: params.roomId,
    senderId: params.sender.uid,
    senderName: params.sender.displayName.slice(0, 60),
    senderPhoto: params.sender.photoURL.slice(0, 2000),
    kind: params.kind,
    text: params.text.trim().slice(0, 400),
    giftId: '',
    giftName: '',
    giftEmoji: '',
    recipientName: '',
    createdAt: serverTimestamp(),
  });
}

export async function sendAudioSignal(params: {
  roomId: string;
  fromUid: string;
  toUid: string;
  type: 'offer' | 'answer' | 'ice';
  payload: string;
}): Promise<void> {
  const signalId = makeId('asig');
  try {
    await setDoc(doc(db, 'audioRooms', params.roomId, 'signals', signalId), {
      id: signalId,
      streamId: params.roomId,
      fromUid: params.fromUid,
      toUid: params.toUid,
      type: params.type,
      payload: params.payload.slice(0, 16000),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn('Audio signal send warning:', error);
  }
}

export function subscribeAudioSignals(
  roomId: string,
  myUid: string,
  onSignal: (sig: WebRTCSignal) => void
): () => void {
  const q = query(
    collection(db, 'audioRooms', roomId, 'signals'),
    where('toUid', '==', myUid),
    limit(150)
  );
  return onSnapshot(q, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const sig = change.doc.data() as WebRTCSignal;
        onSignal(sig);
        void deleteDoc(change.doc.ref).catch(() => {});
      }
    });
  });
}

// ---------------- VIRTUAL GIFTS & COIN PACKAGES ----------------
export function subscribeVirtualGifts(onData: (gifts: VirtualGift[]) => void): () => void {
  const q = query(collection(db, 'virtualGifts'), limit(50));
  return onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        onData(DEFAULT_VIRTUAL_GIFTS);
        return;
      }
      const list = snap.docs.map((d) => d.data() as VirtualGift);
      const loveDefault = DEFAULT_VIRTUAL_GIFTS.find((g) => g.id === 'gift_love_couple');
      if (loveDefault && !list.some((g) => g.id === 'gift_love_couple')) {
        list.push(loveDefault);
      }
      list.sort((a, b) => a.coinPrice - b.coinPrice);
      onData(list);
    },
    () => onData(DEFAULT_VIRTUAL_GIFTS)
  );
}

export async function saveVirtualGift(gift: Omit<VirtualGift, 'createdAt' | 'updatedAt'>): Promise<void> {
  const ref = doc(db, 'virtualGifts', gift.id);
  const existing = await getDoc(ref);
  await setDoc(ref, {
    ...gift,
    name: gift.name.trim().slice(0, 40),
    emoji: gift.emoji.trim().slice(0, 16),
    coinPrice: Math.max(1, Math.round(gift.coinPrice)),
    createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteVirtualGift(giftId: string): Promise<void> {
  await deleteDoc(doc(db, 'virtualGifts', giftId));
}

export function subscribeCoinPackages(onData: (pkgs: CoinPackage[]) => void): () => void {
  const q = query(collection(db, 'coinPackages'), limit(30));
  return onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        onData(DEFAULT_COIN_PACKAGES);
        return;
      }
      const legacySet = new Set<string>(LEGACY_COIN_PACKAGE_IDS);
      const list = snap.docs
        .map((d) => d.data() as CoinPackage)
        .filter((pkg) => !legacySet.has(pkg.id));
      if (list.length === 0) {
        onData(DEFAULT_COIN_PACKAGES);
        return;
      }
      list.sort((a, b) => a.coins - b.coins);
      onData(list);
    },
    () => onData(DEFAULT_COIN_PACKAGES)
  );
}

export async function saveCoinPackage(pkg: Omit<CoinPackage, 'createdAt' | 'updatedAt'>): Promise<void> {
  const ref = doc(db, 'coinPackages', pkg.id);
  const existing = await getDoc(ref);
  await setDoc(ref, {
    ...pkg,
    name: pkg.name.trim().slice(0, 60),
    coins: Math.max(1, Math.round(pkg.coins)),
    bonusCoins: Math.max(0, Math.round(pkg.bonusCoins)),
    priceUsd: Math.max(0, Number(pkg.priceUsd)),
    priceInr: Math.max(0, Math.round(pkg.priceInr)),
    createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteCoinPackage(packageId: string): Promise<void> {
  await deleteDoc(doc(db, 'coinPackages', packageId));
}

// ---------------- USER WALLET, GIFT SENDING & TOPUPS ----------------
export async function ensureUserWallet(uid: string): Promise<UserWallet> {
  const ref = doc(db, 'wallets', uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return snap.data() as UserWallet;
  }
  const initial: UserWallet = {
    uid,
    coinsBalance: 100,
    earnedBeans: 0,
    totalSpent: 0,
    totalPurchased: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const batch = writeBatch(db);
  batch.set(ref, initial);
  const txId = makeId('tx');
  batch.set(doc(db, 'coinTransactions', txId), {
    id: txId,
    userId: uid,
    counterpartyId: 'bandhu_mela',
    counterpartyName: 'BANDHU MELA Welcome',
    type: 'starter',
    coinsDelta: 100,
    note: 'Welcome starter coins for Audio Party gifts',
    referenceId: 'starter_bonus',
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  return initial;
}

export function subscribeMyWallet(uid: string, onData: (wallet: UserWallet | null) => void): () => void {
  return onSnapshot(
    doc(db, 'wallets', uid),
    (snap) => onData(snap.exists() ? (snap.data() as UserWallet) : null),
    (error) => console.warn('Wallet listener warning:', error)
  );
}

export async function fetchAllWalletsOwner(): Promise<UserWallet[]> {
  try {
    const snap = await getDocs(query(collection(db, 'wallets'), limit(150)));
    return snap.docs.map((d) => d.data() as UserWallet);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'wallets');
  }
}

const inFlightGiftSends = new Set<string>();

export async function sendVirtualGift(params: {
  room: AudioRoom;
  sender: UserProfile;
  recipient: { uid: string; displayName: string };
  gift: VirtualGift;
}): Promise<{
  eventId: string;
  transactionId: string;
  coinsCost: number;
  giftName: string;
  giftEmoji: string;
  animationType: VirtualGift['animationType'];
}> {
  if (params.sender.uid === params.recipient.uid) {
    throw new Error('Select a co-host or guest speaker on stage to send a gift.');
  }

  const sendLockKey = `${params.room.id}:${params.sender.uid}:${params.gift.id}`;
  if (inFlightGiftSends.has(sendLockKey)) {
    throw new Error('Gift transaction is already being processed...');
  }
  inFlightGiftSends.add(sendLockKey);

  try {
    await ensureUserWallet(params.sender.uid);

    const senderWalletRef = doc(db, 'wallets', params.sender.uid);
    const recipientWalletRef = doc(db, 'wallets', params.recipient.uid);
    const giftCatalogRef = doc(db, 'virtualGifts', params.gift.id);
    const roomRef = doc(db, 'audioRooms', params.room.id);

    const eventId = makeId('gft');
    const txSentId = makeId('txs');
    const txRecvId = makeId('txr');
    const msgId = makeId('amsg');

    const result = await runTransaction(db, async (tx) => {
      const [senderSnap, recipientSnap, giftSnap, roomSnap] = await Promise.all([
        tx.get(senderWalletRef),
        tx.get(recipientWalletRef),
        tx.get(giftCatalogRef),
        tx.get(roomRef),
      ]);

      if (!roomSnap.exists() || (roomSnap.data() as AudioRoom).status !== 'live') {
        throw new Error('This Audio Party room is no longer live.');
      }

      if (!senderSnap.exists()) {
        throw new Error('Sender wallet is not initialized yet. Please try again.');
      }

      if (!recipientSnap.exists()) {
        throw new Error(`${params.recipient.displayName} has not activated their wallet yet.`);
      }

      const catalogGift = giftSnap.exists() ? (giftSnap.data() as VirtualGift) : params.gift;
      if (!catalogGift.active) {
        throw new Error(`${catalogGift.name} is currently disabled by the Platform Owner.`);
      }

      const livePrice = Math.max(1, Math.round(catalogGift.coinPrice));
      const liveName = catalogGift.name.trim().slice(0, 40);
      const liveEmoji = catalogGift.emoji.trim().slice(0, 16);
      const liveAnim = catalogGift.animationType;

      const senderWallet = senderSnap.data() as UserWallet;
      if (senderWallet.coinsBalance < livePrice) {
        throw new Error(`Not enough coins (${senderWallet.coinsBalance} available, ${livePrice} needed).`);
      }

      tx.update(senderWalletRef, {
        coinsBalance: senderWallet.coinsBalance - livePrice,
        totalSpent: senderWallet.totalSpent + livePrice,
        updatedAt: serverTimestamp(),
      });
      tx.update(recipientWalletRef, {
        earnedBeans: increment(livePrice),
        updatedAt: serverTimestamp(),
      });
      tx.set(doc(db, 'giftEvents', eventId), {
        id: eventId,
        roomId: params.room.id,
        roomTitle: params.room.title.slice(0, 120),
        senderId: params.sender.uid,
        senderName: params.sender.displayName.slice(0, 60),
        senderPhoto: params.sender.photoURL.slice(0, 2000),
        recipientId: params.recipient.uid,
        recipientName: params.recipient.displayName.slice(0, 60),
        giftId: params.gift.id,
        giftName: liveName,
        giftEmoji: liveEmoji,
        coinsCost: livePrice,
        transactionId: txSentId,
        animationType: liveAnim,
        createdAt: serverTimestamp(),
      });
      tx.set(doc(db, 'coinTransactions', txSentId), {
        id: txSentId,
        userId: params.sender.uid,
        counterpartyId: params.recipient.uid,
        counterpartyName: params.recipient.displayName.slice(0, 60),
        type: 'gift_sent',
        coinsDelta: -livePrice,
        note: `Sent ${liveEmoji} ${liveName} to ${params.recipient.displayName} (#${txSentId})`,
        referenceId: eventId,
        createdAt: serverTimestamp(),
      });
      tx.set(doc(db, 'coinTransactions', txRecvId), {
        id: txRecvId,
        userId: params.recipient.uid,
        counterpartyId: params.sender.uid,
        counterpartyName: params.sender.displayName.slice(0, 60),
        type: 'gift_received',
        coinsDelta: livePrice,
        note: `Received ${liveEmoji} ${liveName} from ${params.sender.displayName} (#${txRecvId})`,
        referenceId: eventId,
        createdAt: serverTimestamp(),
      });
      tx.set(doc(db, 'audioRooms', params.room.id, 'messages', msgId), {
        id: msgId,
        roomId: params.room.id,
        senderId: params.sender.uid,
        senderName: params.sender.displayName.slice(0, 60),
        senderPhoto: params.sender.photoURL.slice(0, 2000),
        kind: 'gift',
        text: `sent ${liveName} to ${params.recipient.displayName}`,
        giftId: params.gift.id,
        giftName: liveName,
        giftEmoji: liveEmoji,
        recipientName: params.recipient.displayName.slice(0, 60),
        createdAt: serverTimestamp(),
      });
      tx.update(roomRef, {
        giftsCoinsTotal: increment(livePrice),
        updatedAt: serverTimestamp(),
      });

      return {
        eventId,
        transactionId: txSentId,
        coinsCost: livePrice,
        giftName: liveName,
        giftEmoji: liveEmoji,
        animationType: liveAnim,
      };
    });

    return result;
  } finally {
    inFlightGiftSends.delete(sendLockKey);
  }
}

export function subscribeRoomGiftEvents(
  roomId: string,
  onData: (events: GiftEvent[], meta?: { fromCache: boolean }) => void
): () => void {
  const q = query(collection(db, 'giftEvents'), where('roomId', '==', roomId));
  return onSnapshot(
    q,
    (snap) => {
      // Only emit backend-confirmed gift events (ignore optimistic pending local writes)
      const list = snap.docs
        .filter((d) => !d.metadata.hasPendingWrites)
        .map((d) => d.data() as GiftEvent);
      list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(list, { fromCache: snap.metadata.fromCache });
    },
    (error) => console.warn('Room gift events warning:', error)
  );
}

export function subscribeMyGiftHistory(
  uid: string,
  onData: (sent: GiftEvent[], received: GiftEvent[]) => void
): () => void {
  const qSent = query(collection(db, 'giftEvents'), where('senderId', '==', uid), limit(60));
  const qRecv = query(collection(db, 'giftEvents'), where('recipientId', '==', uid), limit(60));
  let sentList: GiftEvent[] = [];
  let recvList: GiftEvent[] = [];
  const emit = () => onData(sentList, recvList);

  const u1 = onSnapshot(qSent, (snap) => {
    sentList = snap.docs.map((d) => d.data() as GiftEvent).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    emit();
  });
  const u2 = onSnapshot(qRecv, (snap) => {
    recvList = snap.docs.map((d) => d.data() as GiftEvent).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    emit();
  });
  return () => {
    u1();
    u2();
  };
}

export function subscribeMyCoinTransactions(
  uid: string,
  onData: (txs: CoinTransaction[]) => void
): () => void {
  const q = query(collection(db, 'coinTransactions'), where('userId', '==', uid), limit(80));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as CoinTransaction);
      list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(list);
    },
    (error) => console.warn('Transactions listener warning:', error)
  );
}

export async function fetchAllCoinTransactionsOwner(): Promise<CoinTransaction[]> {
  try {
    const snap = await getDocs(query(collection(db, 'coinTransactions'), limit(150)));
    const list = snap.docs.map((d) => d.data() as CoinTransaction);
    list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'coinTransactions');
  }
}

export async function submitCoinTopupRequest(params: {
  user: UserProfile;
  pkg: CoinPackage;
  paymentProvider: CoinTopupRequest['paymentProvider'];
  paymentRef: string;
}): Promise<string> {
  const id = makeId('top');
  const totalCoins = params.pkg.coins + (params.pkg.bonusCoins || 0);
  await setDoc(doc(db, 'coinTopupRequests', id), {
    id,
    userId: params.user.uid,
    username: params.user.username.slice(0, 30),
    packageId: params.pkg.id,
    packageName: params.pkg.name.slice(0, 60),
    coins: totalCoins,
    amountLabel: `₹${params.pkg.priceInr.toLocaleString('en-IN')}`,
    paymentProvider: params.paymentProvider,
    paymentRef: params.paymentRef.slice(0, 160),
    status: 'pending',
    adminNote: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return id;
}

export function subscribeMyCoinTopupRequests(
  uid: string,
  onData: (items: CoinTopupRequest[]) => void
): () => void {
  const q = query(collection(db, 'coinTopupRequests'), where('userId', '==', uid), limit(40));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as CoinTopupRequest);
      list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(list);
    },
    (error) => console.warn('Topup requests listener warning:', error)
  );
}

export async function fetchAllCoinTopupRequestsOwner(): Promise<CoinTopupRequest[]> {
  try {
    const snap = await getDocs(query(collection(db, 'coinTopupRequests'), limit(100)));
    const list = snap.docs.map((d) => d.data() as CoinTopupRequest);
    list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'coinTopupRequests');
  }
}

export async function reviewCoinTopupRequestOwner(
  reqItem: CoinTopupRequest,
  decision: 'approved' | 'rejected',
  adminNote: string,
  ownerActor: UserProfile
): Promise<void> {
  const reqRef = doc(db, 'coinTopupRequests', reqItem.id);
  const walletRef = doc(db, 'wallets', reqItem.userId);
  const walletSnap = await getDoc(walletRef);

  const batch = writeBatch(db);
  batch.update(reqRef, {
    status: decision,
    adminNote: adminNote.trim().slice(0, 300),
    updatedAt: serverTimestamp(),
  });

  if (decision === 'approved') {
    if (walletSnap.exists()) {
      batch.update(walletRef, {
        coinsBalance: increment(reqItem.coins),
        totalPurchased: increment(reqItem.coins),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(walletRef, {
        uid: reqItem.userId,
        coinsBalance: reqItem.coins,
        earnedBeans: 0,
        totalSpent: 0,
        totalPurchased: reqItem.coins,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    const txId = makeId('txp');
    batch.set(doc(db, 'coinTransactions', txId), {
      id: txId,
      userId: reqItem.userId,
      counterpartyId: ownerActor.uid,
      counterpartyName: 'BANDHU MELA Coin Store',
      type: 'purchase',
      coinsDelta: reqItem.coins,
      note: `Approved ${reqItem.packageName} (${reqItem.amountLabel})`,
      referenceId: reqItem.id,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();

  await logAdminAction({
    actor: ownerActor,
    actorRole: 'owner',
    action: `coin_topup_${decision}`,
    targetType: 'coinTopupRequest',
    targetId: reqItem.id,
    details: `${decision} ${reqItem.coins} coins for @${reqItem.username}`,
  });
}

export async function adjustUserWalletOwner(params: {
  ownerActor: UserProfile;
  targetUid: string;
  deltaCoins: number;
  note: string;
}): Promise<void> {
  const walletRef = doc(db, 'wallets', params.targetUid);
  const snap = await getDoc(walletRef);
  const current = snap.exists() ? (snap.data() as UserWallet) : null;
  const nextBalance = Math.max(0, (current?.coinsBalance || 0) + params.deltaCoins);

  const batch = writeBatch(db);
  if (current) {
    batch.update(walletRef, {
      coinsBalance: nextBalance,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(walletRef, {
      uid: params.targetUid,
      coinsBalance: nextBalance,
      earnedBeans: 0,
      totalSpent: 0,
      totalPurchased: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  const txId = makeId('txo');
  batch.set(doc(db, 'coinTransactions', txId), {
    id: txId,
    userId: params.targetUid,
    counterpartyId: params.ownerActor.uid,
    counterpartyName: 'Owner Super Admin',
    type: 'owner_adjustment',
    coinsDelta: params.deltaCoins,
    note: params.note.trim().slice(0, 200) || 'Owner balance adjustment',
    referenceId: txId,
    createdAt: serverTimestamp(),
  });
  await batch.commit();

  await logAdminAction({
    actor: params.ownerActor,
    actorRole: 'owner',
    action: 'wallet_adjustment',
    targetType: 'wallet',
    targetId: params.targetUid,
    details: `Adjusted balance by ${params.deltaCoins} coins: ${params.note}`,
  });
}
