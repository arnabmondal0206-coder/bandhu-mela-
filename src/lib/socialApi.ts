import { deleteUser, User } from 'firebase/auth';
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
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  AdminRecord,
  Announcement,
  AppSettings,
  AspectRatio,
  BlockRecord,
  CallSession,
  ChatMessage,
  Community,
  CommunityMember,
  CommunityPost,
  Conversation,
  EventRsvp,
  FollowRecord,
  FriendRequest,
  LiveComment,
  LiveStream,
  MediaType,
  ModerationReport,
  NotificationItem,
  Post,
  PostComment,
  SocialEvent,
  StoryItem,
  SupportTicket,
  UserPresence,
  UserPrivateInfo,
  UserProfile,
  WebRTCSignal,
} from '../types/social';
import { auth, BOOTSTRAP_ADMIN_EMAIL, db, handleFirestoreError, OperationType, ORIGINAL_OWNER_UID } from './firebase';

const spamActionTimestamps = new Map<string, number[]>();
const lastSubmittedPayload = new Map<string, string>();

export function checkSpamGuard(actionKey: string, text: string, minIntervalMs = 2500): void {
  const now = Date.now();
  const recent = (spamActionTimestamps.get(actionKey) || []).filter((ts) => now - ts < 60_000);
  const lastTs = recent[recent.length - 1] || 0;
  if (now - lastTs < minIntervalMs) {
    throw new Error('Please wait a moment before posting again (spam protection active).');
  }
  if (recent.length >= 12) {
    throw new Error('Rate limit reached: please wait a minute before sending more content.');
  }
  const urlMatches = text.match(/https?:\/\/[^\s]+/gi) || [];
  if (urlMatches.length > 3) {
    throw new Error('Too many external links in a single submission (max 3 links allowed).');
  }
  const normalized = text.trim().toLowerCase();
  if (normalized.length > 10 && lastSubmittedPayload.get(actionKey) === normalized) {
    throw new Error('Duplicate content detected. Please share something new.');
  }
  recent.push(now);
  spamActionTimestamps.set(actionKey, recent);
  if (normalized) {
    lastSubmittedPayload.set(actionKey, normalized);
  }
}

export const DEFAULT_COVER_BANNER = '/src/assets/images/cover_twilight_terrace_1794810238967.jpg';
export const DEFAULT_AVATAR = '/src/assets/images/avatar_creator_portrait_1794810240223.jpg';

export function toMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'object' && ts !== null && 'toMillis' in ts && typeof (ts as { toMillis: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  if (ts instanceof Date) return ts.getTime();
  return 0;
}

export function formatRelativeTime(ts: unknown): string {
  const ms = toMillis(ts);
  if (!ms) return 'Just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function sanitizeUsername(raw: string, fallbackUid: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  if (cleaned.length >= 3) return cleaned;
  return `bandhu_${fallbackUid.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'user'}`;
}

export function extractHashtags(text: string): string[] {
  const matches = text.match(/#[a-zA-Z0-9_\u0980-\u09FF]+/g) || [];
  const unique = Array.from(new Set(matches.map((tag) => tag.toLowerCase().slice(0, 40))));
  return unique.slice(0, 15);
}

export function makeId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function makePairId(uidA: string, uidB: string): string {
  return uidA < uidB ? `${uidA}_${uidB}` : `${uidB}_${uidA}`;
}

export async function ensureUserProfile(
  authUser: User,
  overrides?: { displayName?: string; username?: string; phoneNumber?: string }
): Promise<UserProfile> {
  const userPath = `users/${authUser.uid}`;
  const privatePath = `users/${authUser.uid}/private/info`;
  const userRef = doc(db, 'users', authUser.uid);
  const privateRef = doc(db, 'users', authUser.uid, 'private', 'info');

  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const existingProfile = snap.data() as Partial<UserProfile>;
      const normalized: UserProfile = {
        uid: authUser.uid,
        username: existingProfile.username || sanitizeUsername('', authUser.uid),
        displayName: existingProfile.displayName || authUser.displayName || 'Bandhu Member',
        bio: existingProfile.bio ?? '',
        location: existingProfile.location ?? '',
        workOrBioTag: existingProfile.workOrBioTag ?? '',
        photoURL: existingProfile.photoURL || authUser.photoURL || DEFAULT_AVATAR,
        coverURL: existingProfile.coverURL || DEFAULT_COVER_BANNER,
        profileVisibility: existingProfile.profileVisibility || 'public',
        messagePrivacy: existingProfile.messagePrivacy || 'everyone',
        showOnlineStatus: existingProfile.showOnlineStatus ?? true,
        isVerified: existingProfile.isVerified ?? false,
        followersCount: existingProfile.followersCount ?? 0,
        followingCount: existingProfile.followingCount ?? 0,
        postsCount: existingProfile.postsCount ?? 0,
        isSuspended: existingProfile.isSuspended ?? false,
        createdAt: existingProfile.createdAt,
        updatedAt: existingProfile.updatedAt,
      };
      const privSnap = await getDoc(privateRef).catch(() => null);
      if (!privSnap || !privSnap.exists()) {
        await setDoc(privateRef, {
          uid: authUser.uid,
          email: (authUser.email || '').slice(0, 120),
          phoneNumber: (overrides?.phoneNumber || authUser.phoneNumber || '').slice(0, 24),
          role: 'user',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      return normalized;
    }

    const baseName =
      overrides?.displayName?.trim() ||
      authUser.displayName?.trim() ||
      authUser.email?.split('@')[0] ||
      'Bandhu Member';
    const displayName = baseName.slice(0, 60);
    const username = sanitizeUsername(
      overrides?.username || authUser.email?.split('@')[0] || baseName,
      authUser.uid
    );

    const newProfile: UserProfile = {
      uid: authUser.uid,
      username,
      displayName,
      bio: 'Sharing moments on BANDHU MELA.',
      location: '',
      workOrBioTag: '',
      photoURL: (authUser.photoURL || DEFAULT_AVATAR).slice(0, 2000),
      coverURL: DEFAULT_COVER_BANNER,
      profileVisibility: 'public',
      messagePrivacy: 'everyone',
      showOnlineStatus: true,
      isVerified: false,
      followersCount: 0,
      followingCount: 0,
      postsCount: 0,
      isSuspended: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const batch = writeBatch(db);
    batch.set(userRef, newProfile);
    batch.set(privateRef, {
      uid: authUser.uid,
      email: (authUser.email || '').slice(0, 120),
      phoneNumber: (overrides?.phoneNumber || authUser.phoneNumber || '').slice(0, 24),
      role: 'user',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();

    const createdSnap = await getDoc(userRef);
    return (createdSnap.data() as UserProfile) || newProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${userPath} / ${privatePath}`);
  }
}

export async function getPrivateUserInfo(uid: string): Promise<UserPrivateInfo | null> {
  const path = `users/${uid}/private/info`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'private', 'info'));
    return snap.exists() ? (snap.data() as UserPrivateInfo) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function updateUserProfile(
  uid: string,
  updates: {
    displayName: string;
    username: string;
    bio: string;
    location: string;
    workOrBioTag: string;
    photoURL: string;
    coverURL: string;
    phoneNumber?: string;
    email?: string;
  }
): Promise<void> {
  const userPath = `users/${uid}`;
  try {
    const cleanUsername = sanitizeUsername(updates.username, uid);
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', uid), {
      displayName: updates.displayName.trim().slice(0, 60) || 'Bandhu Member',
      username: cleanUsername,
      bio: updates.bio.trim().slice(0, 300),
      location: updates.location.trim().slice(0, 80),
      workOrBioTag: updates.workOrBioTag.trim().slice(0, 80),
      photoURL: updates.photoURL.slice(0, 2000),
      coverURL: updates.coverURL.slice(0, 2000),
      updatedAt: serverTimestamp(),
    });

    if (typeof updates.phoneNumber === 'string') {
      batch.update(doc(db, 'users', uid, 'private', 'info'), {
        phoneNumber: updates.phoneNumber.trim().slice(0, 24),
        email: (updates.email || '').slice(0, 120),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }
}

export async function updatePrivacySettings(
  uid: string,
  settings: {
    profileVisibility: 'public' | 'friends';
    messagePrivacy: 'everyone' | 'friends';
    showOnlineStatus: boolean;
  }
): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', uid), {
      profileVisibility: settings.profileVisibility,
      messagePrivacy: settings.messagePrivacy,
      showOnlineStatus: settings.showOnlineStatus,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function setUserPresence(uid: string, isOnline: boolean): Promise<void> {
  try {
    await setDoc(doc(db, 'presence', uid), {
      uid,
      isOnline,
      lastSeen: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking presence update
  }
}

export function subscribeAllPresence(onData: (map: Record<string, UserPresence>) => void): () => void {
  const q = query(collection(db, 'presence'), limit(150));
  return onSnapshot(
    q,
    (snap) => {
      const next: Record<string, UserPresence> = {};
      snap.docs.forEach((d) => {
        const p = d.data() as UserPresence;
        next[p.uid] = p;
      });
      onData(next);
    },
    (error) => console.warn('Presence listener warning:', error)
  );
}

export interface OriginalOwnerStatus {
  isOriginalOwner: boolean;
  ownerUid: string | null;
  locked: boolean;
  backendVerified: boolean;
}

export async function claimAndVerifyOriginalOwner(authUser: User): Promise<OriginalOwnerStatus> {
  const isCandidate =
    Boolean(authUser.emailVerified) &&
    authUser.uid === ORIGINAL_OWNER_UID &&
    authUser.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL;

  const registryRef = doc(db, 'ownerRegistry', 'original');
  let registrySnap;
  try {
    registrySnap = await getDoc(registryRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'ownerRegistry/original');
  }

  let ownerUid: string | null = null;
  let locked = false;

  if (registrySnap.exists()) {
    const data = registrySnap.data() as {
      uid?: string;
      role?: string;
      locked?: boolean;
      email?: string;
    };
    ownerUid = data.uid || null;
    locked = Boolean(data.locked);
  } else if (isCandidate) {
    try {
      await setDoc(registryRef, {
        id: 'original',
        uid: authUser.uid,
        email: BOOTSTRAP_ADMIN_EMAIL,
        role: 'super_admin_owner',
        locked: true,
        claimedAt: serverTimestamp(),
      });
      ownerUid = authUser.uid;
      locked = true;

      const settingsRef = doc(db, 'appSettings', 'platform');
      const settingsSnap = await getDoc(settingsRef).catch(() => null);
      if (!settingsSnap || !settingsSnap.exists()) {
        await setDoc(settingsRef, {
          ...DEFAULT_APP_SETTINGS,
          ownerUid: authUser.uid,
          updatedBy: authUser.uid,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      } else if (!settingsSnap.data()?.ownerUid) {
        await updateDoc(settingsRef, {
          ownerUid: authUser.uid,
          updatedBy: authUser.uid,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    } catch {
      const recheck = await getDoc(registryRef).catch(() => null);
      if (recheck && recheck.exists()) {
        const data = recheck.data() as { uid?: string; locked?: boolean };
        ownerUid = data.uid || null;
        locked = Boolean(data.locked);
      }
    }
  }

  const isOriginalOwner = Boolean(
    isCandidate && ownerUid && ownerUid === ORIGINAL_OWNER_UID && ownerUid === authUser.uid
  );
  if (!isOriginalOwner) {
    return { isOriginalOwner: false, ownerUid: ownerUid || ORIGINAL_OWNER_UID, locked, backendVerified: false };
  }

  let backendVerified = false;
  try {
    const idToken = await authUser.getIdToken();
    const resp = await fetch('/api/owner/verify', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
    });
    if (resp.ok) {
      const payload = (await resp.json()) as {
        verified?: boolean;
        isOriginalOwner?: boolean;
        ownerUid?: string;
      };
      backendVerified = Boolean(
        payload.verified && payload.isOriginalOwner && payload.ownerUid === authUser.uid
      );
    }
  } catch {
    backendVerified = false;
  }

  return {
    isOriginalOwner: true,
    ownerUid: authUser.uid,
    locked,
    backendVerified,
  };
}

export async function checkIsAdminRecord(uid: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'admins', uid));
    return snap.exists() && !snap.data()?.isSuspended;
  } catch {
    return false;
  }
}

const CACHE_POSTS_KEY = 'bandhu_cache_posts_v1';
const CACHE_USERS_KEY = 'bandhu_cache_users_v1';

export function getCachedFeedPosts(): Post[] {
  try {
    const raw = localStorage.getItem(CACHE_POSTS_KEY);
    return raw ? (JSON.parse(raw) as Post[]) : [];
  } catch {
    return [];
  }
}

export function getCachedUsers(): UserProfile[] {
  try {
    const raw = localStorage.getItem(CACHE_USERS_KEY);
    return raw ? (JSON.parse(raw) as UserProfile[]) : [];
  } catch {
    return [];
  }
}

export function rankTrendingPosts(posts: Post[]): Post[] {
  const now = Date.now();
  return [...posts].sort((a, b) => {
    const ageHrsA = Math.max(1, (now - (toMillis(a.createdAt) || now)) / 3_600_000);
    const ageHrsB = Math.max(1, (now - (toMillis(b.createdAt) || now)) / 3_600_000);
    const engA = a.likesCount * 2 + a.commentsCount * 3 + a.sharesCount * 4 + (a.mediaUrl ? 1.5 : 0);
    const engB = b.likesCount * 2 + b.commentsCount * 3 + b.sharesCount * 4 + (b.mediaUrl ? 1.5 : 0);
    const scoreA = (engA + 1) / Math.pow(ageHrsA + 2, 1.15);
    const scoreB = (engB + 1) / Math.pow(ageHrsB + 2, 1.15);
    return scoreB - scoreA;
  });
}

export function getSuggestedFriends(
  currentUser: UserProfile,
  allUsers: UserProfile[],
  followingIds: Set<string>,
  friendRequests: FriendRequest[],
  blockedIds: Set<string>
): UserProfile[] {
  const friendUids = new Set(
    friendRequests
      .filter((r) => r.status === 'accepted' || r.status === 'pending')
      .map((r) => (r.senderId === currentUser.uid ? r.receiverId : r.senderId))
  );
  const myLoc = currentUser.location.trim().toLowerCase();
  const myTag = currentUser.workOrBioTag.trim().toLowerCase();

  return allUsers
    .filter((u) => u.uid !== currentUser.uid && !blockedIds.has(u.uid) && !friendUids.has(u.uid))
    .map((u) => {
      let score = 0;
      if (!followingIds.has(u.uid)) score += 3;
      if (myLoc && u.location.toLowerCase().includes(myLoc)) score += 4;
      if (myTag && u.workOrBioTag.toLowerCase().includes(myTag)) score += 3;
      if (u.isVerified) score += 2;
      score += Math.min(4, Math.floor((u.postsCount + u.followersCount) / 3));
      return { user: u, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.user);
}

export function subscribeFeedPosts(
  onData: (posts: Post[]) => void,
  onErr?: (err: Error) => void,
  pageLimit = 20
): () => void {
  const q = query(collection(db, 'posts'), where('status', '==', 'active'), limit(pageLimit));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => {
        const raw = d.data() as Partial<Post>;
        return {
          ...raw,
          hashtags: Array.isArray(raw.hashtags) ? raw.hashtags : extractHashtags(raw.caption || ''),
        } as Post;
      });
      list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      try {
        localStorage.setItem(CACHE_POSTS_KEY, JSON.stringify(list.slice(0, 20)));
      } catch {
        // Ignore storage quota warnings
      }
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'posts');
      } catch (e) {
        if (onErr && e instanceof Error) onErr(e);
      }
    }
  );
}

export function subscribeAllUsers(onData: (users: UserProfile[]) => void): () => void {
  const q = query(collection(db, 'users'), where('isSuspended', '==', false), limit(60));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => {
        const raw = d.data() as Partial<UserProfile>;
        return {
          location: '',
          workOrBioTag: '',
          profileVisibility: 'public',
          messagePrivacy: 'everyone',
          showOnlineStatus: true,
          isVerified: false,
          ...raw,
        } as UserProfile;
      });
      list.sort((a, b) => a.displayName.localeCompare(b.displayName));
      try {
        localStorage.setItem(CACHE_USERS_KEY, JSON.stringify(list.slice(0, 40)));
      } catch {
        // Ignore storage quota warnings
      }
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'users')
  );
}

export async function createPost(params: {
  author: UserProfile;
  caption: string;
  mediaUrl: string;
  mediaType: MediaType;
  aspectRatio: AspectRatio;
}): Promise<string> {
  const postId = makeId('post');
  const path = `posts/${postId}`;
  const cleanCaption = params.caption.trim().slice(0, 2200);
  checkSpamGuard(`post:${params.author.uid}`, cleanCaption || params.mediaUrl, 3000);
  const hashtags = extractHashtags(cleanCaption);

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'posts', postId), {
      id: postId,
      authorId: params.author.uid,
      authorName: params.author.displayName.slice(0, 60),
      authorUsername: params.author.username.slice(0, 30),
      authorPhoto: params.author.photoURL.slice(0, 2000),
      caption: cleanCaption,
      hashtags,
      mediaUrl: params.mediaUrl.trim().slice(0, 2000),
      mediaType: params.mediaType,
      aspectRatio: params.aspectRatio,
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'users', params.author.uid), {
      postsCount: increment(1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return postId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deletePost(postId: string, authorId: string): Promise<void> {
  const path = `posts/${postId}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'posts', postId));
    batch.update(doc(db, 'users', authorId), {
      postsCount: increment(-1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeSavedPostIds(
  uid: string,
  onData: (savedIds: Set<string>) => void
): () => void {
  const q = query(collection(db, 'users', uid, 'savedPosts'), limit(200));
  return onSnapshot(
    q,
    (snap) => {
      onData(new Set(snap.docs.map((d) => d.id)));
    },
    (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/savedPosts`)
  );
}

export async function toggleSavePost(
  uid: string,
  postId: string,
  currentlySaved: boolean
): Promise<boolean> {
  const path = `users/${uid}/savedPosts/${postId}`;
  try {
    const ref = doc(db, 'users', uid, 'savedPosts', postId);
    if (currentlySaved) {
      await deleteDoc(ref);
      return false;
    }
    await setDoc(ref, {
      postId,
      userId: uid,
      createdAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function checkUserLikedPost(postId: string, uid: string): Promise<boolean> {
  const path = `posts/${postId}/likes/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'posts', postId, 'likes', uid));
    return snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function toggleLikePost(
  post: Post,
  actor: UserProfile,
  currentlyLiked: boolean
): Promise<boolean> {
  const likePath = `posts/${post.id}/likes/${actor.uid}`;
  try {
    const likeRef = doc(db, 'posts', post.id, 'likes', actor.uid);
    const postRef = doc(db, 'posts', post.id);
    const batch = writeBatch(db);

    if (currentlyLiked) {
      batch.delete(likeRef);
      batch.update(postRef, {
        likesCount: increment(-1),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(likeRef, {
        userId: actor.uid,
        postId: post.id,
        createdAt: serverTimestamp(),
      });
      batch.update(postRef, {
        likesCount: increment(1),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();

    if (!currentlyLiked && post.authorId !== actor.uid) {
      await createNotification({
        recipientId: post.authorId,
        actor,
        type: 'like',
        postId: post.id,
        message: `${actor.displayName} liked your ${post.mediaType === 'reel' ? 'reel' : 'post'}.`,
      });
    }

    return !currentlyLiked;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, likePath);
  }
}

export function subscribePostComments(
  postId: string,
  onData: (comments: PostComment[]) => void
): () => void {
  const q = query(
    collection(db, 'posts', postId, 'comments'),
    where('postId', '==', postId),
    limit(100)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => d.data() as PostComment);
      list.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, `posts/${postId}/comments`)
  );
}

export async function addPostComment(
  post: Post,
  actor: UserProfile,
  text: string
): Promise<void> {
  checkSpamGuard(`cmt:${actor.uid}`, text, 1500);
  const commentId = makeId('cmt');
  const path = `posts/${post.id}/comments/${commentId}`;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'posts', post.id, 'comments', commentId), {
      id: commentId,
      postId: post.id,
      authorId: actor.uid,
      authorName: actor.displayName.slice(0, 60),
      authorUsername: actor.username.slice(0, 30),
      authorPhoto: actor.photoURL.slice(0, 2000),
      text: text.trim().slice(0, 1000),
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, 'posts', post.id), {
      commentsCount: increment(1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();

    if (post.authorId !== actor.uid) {
      await createNotification({
        recipientId: post.authorId,
        actor,
        type: 'comment',
        postId: post.id,
        message: `${actor.displayName} commented: "${text.trim().slice(0, 80)}"`,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deletePostComment(postId: string, commentId: string): Promise<void> {
  const path = `posts/${postId}/comments/${commentId}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'posts', postId, 'comments', commentId));
    batch.update(doc(db, 'posts', postId), {
      commentsCount: increment(-1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function incrementPostShare(postId: string): Promise<void> {
  const path = `posts/${postId}`;
  try {
    await updateDoc(doc(db, 'posts', postId), {
      sharesCount: increment(1),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// 24-Hour Stories
export function subscribeActiveStories(onData: (stories: StoryItem[]) => void): () => void {
  const q = query(
    collection(db, 'stories'),
    where('expiresAt', '>', Timestamp.now()),
    limit(60)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as StoryItem);
      list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(list);
    },
    (error) => console.warn('Stories listener warning:', error)
  );
}

export async function createStory(params: {
  author: UserProfile;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  caption: string;
}): Promise<string> {
  const storyId = makeId('sty');
  const expiresAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);
  try {
    await setDoc(doc(db, 'stories', storyId), {
      id: storyId,
      authorId: params.author.uid,
      authorName: params.author.displayName.slice(0, 60),
      authorUsername: params.author.username.slice(0, 30),
      authorPhoto: params.author.photoURL.slice(0, 2000),
      mediaUrl: params.mediaUrl.trim().slice(0, 2000),
      mediaType: params.mediaType,
      caption: params.caption.trim().slice(0, 300),
      viewersCount: 0,
      createdAt: serverTimestamp(),
      expiresAt,
    });
    return storyId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `stories/${storyId}`);
  }
}

export async function incrementStoryView(storyId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'stories', storyId), {
      viewersCount: increment(1),
    });
  } catch {
    // Non-blocking view increment
  }
}

export async function deleteStory(storyId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'stories', storyId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `stories/${storyId}`);
  }
}

export function subscribeMyFollowing(
  uid: string,
  onData: (followingIds: Set<string>) => void
): () => void {
  const q = query(collection(db, 'follows'), where('followerId', '==', uid), limit(200));
  return onSnapshot(
    q,
    (snapshot) => {
      const ids = new Set<string>();
      snapshot.docs.forEach((d) => {
        const rec = d.data() as FollowRecord;
        ids.add(rec.followingId);
      });
      onData(ids);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'follows')
  );
}

export async function toggleFollowUser(
  actor: UserProfile,
  targetUid: string,
  isCurrentlyFollowing: boolean
): Promise<void> {
  const followId = `${actor.uid}_${targetUid}`;
  const path = `follows/${followId}`;
  try {
    const followRef = doc(db, 'follows', followId);
    const batch = writeBatch(db);
    if (isCurrentlyFollowing) {
      batch.delete(followRef);
      batch.update(doc(db, 'users', actor.uid), {
        followingCount: increment(-1),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'users', targetUid), {
        followersCount: increment(-1),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(followRef, {
        followerId: actor.uid,
        followingId: targetUid,
        createdAt: serverTimestamp(),
      });
      batch.update(doc(db, 'users', actor.uid), {
        followingCount: increment(1),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'users', targetUid), {
        followersCount: increment(1),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();

    if (!isCurrentlyFollowing) {
      await createNotification({
        recipientId: targetUid,
        actor,
        type: 'follow',
        postId: '',
        message: `${actor.displayName} started following you.`,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeFriendRequests(
  uid: string,
  onData: (requests: FriendRequest[]) => void
): () => void {
  const qIncoming = query(collection(db, 'friendRequests'), where('receiverId', '==', uid), limit(100));
  const qOutgoing = query(collection(db, 'friendRequests'), where('senderId', '==', uid), limit(100));

  let incomingList: FriendRequest[] = [];
  let outgoingList: FriendRequest[] = [];

  const mergeAndEmit = () => {
    const map = new Map<string, FriendRequest>();
    [...incomingList, ...outgoingList].forEach((r) => map.set(r.id, r));
    const merged = Array.from(map.values()).sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
    onData(merged);
  };

  const unsubIn = onSnapshot(
    qIncoming,
    (snap) => {
      incomingList = snap.docs.map((d) => d.data() as FriendRequest);
      mergeAndEmit();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'friendRequests')
  );

  const unsubOut = onSnapshot(
    qOutgoing,
    (snap) => {
      outgoingList = snap.docs.map((d) => d.data() as FriendRequest);
      mergeAndEmit();
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'friendRequests')
  );

  return () => {
    unsubIn();
    unsubOut();
  };
}

export async function sendFriendRequest(sender: UserProfile, receiver: UserProfile): Promise<void> {
  const requestId = makePairId(sender.uid, receiver.uid);
  const path = `friendRequests/${requestId}`;
  try {
    await setDoc(doc(db, 'friendRequests', requestId), {
      id: requestId,
      senderId: sender.uid,
      senderName: sender.displayName.slice(0, 60),
      senderUsername: sender.username.slice(0, 30),
      senderPhoto: sender.photoURL.slice(0, 2000),
      receiverId: receiver.uid,
      receiverName: receiver.displayName.slice(0, 60),
      receiverUsername: receiver.username.slice(0, 30),
      receiverPhoto: receiver.photoURL.slice(0, 2000),
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await createNotification({
      recipientId: receiver.uid,
      actor: sender,
      type: 'friend_request',
      postId: '',
      message: `${sender.displayName} sent you a friend request.`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function respondFriendRequest(
  request: FriendRequest,
  actor: UserProfile,
  decision: 'accepted' | 'declined'
): Promise<void> {
  const path = `friendRequests/${request.id}`;
  try {
    await updateDoc(doc(db, 'friendRequests', request.id), {
      status: decision,
      updatedAt: serverTimestamp(),
    });

    if (decision === 'accepted') {
      await createNotification({
        recipientId: request.senderId,
        actor,
        type: 'friend_accept',
        postId: '',
        message: `${actor.displayName} accepted your friend request.`,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function removeFriendRequest(requestId: string): Promise<void> {
  const path = `friendRequests/${requestId}`;
  try {
    await deleteDoc(doc(db, 'friendRequests', requestId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeConversations(
  uid: string,
  onData: (conversations: Conversation[]) => void
): () => void {
  const q = query(collection(db, 'conversations'), where('participants', 'array-contains', uid), limit(50));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as Conversation);
      list.sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'conversations')
  );
}

export async function ensureConversation(
  currentUser: UserProfile,
  peer: UserProfile
): Promise<Conversation> {
  const convId = makePairId(currentUser.uid, peer.uid);
  const path = `conversations/${convId}`;
  try {
    const convRef = doc(db, 'conversations', convId);
    const snap = await getDoc(convRef);
    if (snap.exists()) {
      return snap.data() as Conversation;
    }

    const first = currentUser.uid < peer.uid ? currentUser : peer;
    const second = currentUser.uid < peer.uid ? peer : currentUser;

    const payload: Conversation = {
      id: convId,
      isGroup: false,
      groupName: '',
      groupPhoto: '',
      createdBy: currentUser.uid,
      participantA: first.uid,
      participantB: second.uid,
      participants: [first.uid, second.uid],
      participantAName: first.displayName.slice(0, 60),
      participantAPhoto: first.photoURL.slice(0, 2000),
      participantBName: second.displayName.slice(0, 60),
      participantBPhoto: second.photoURL.slice(0, 2000),
      lastMessage: '',
      lastSenderId: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(convRef, payload);
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function createGroupConversation(
  creator: UserProfile,
  groupName: string,
  members: UserProfile[]
): Promise<Conversation> {
  const convId = makeId('grp');
  const participantIds = Array.from(new Set([creator.uid, ...members.map((m) => m.uid)])).slice(0, 25);
  const payload: Conversation = {
    id: convId,
    isGroup: true,
    groupName: groupName.trim().slice(0, 80) || 'Bandhu Group',
    groupPhoto: creator.photoURL.slice(0, 2000),
    createdBy: creator.uid,
    participantA: creator.uid,
    participantB: members[0]?.uid || creator.uid,
    participants: participantIds,
    participantAName: creator.displayName.slice(0, 60),
    participantAPhoto: creator.photoURL.slice(0, 2000),
    participantBName: members[0]?.displayName.slice(0, 60) || 'Members',
    participantBPhoto: members[0]?.photoURL.slice(0, 2000) || '',
    lastMessage: `${creator.displayName} created group "${groupName.trim()}"`,
    lastSenderId: creator.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'conversations', convId), payload);
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `conversations/${convId}`);
  }
}

export function subscribeMessages(
  conversationId: string,
  uid: string,
  onData: (messages: ChatMessage[]) => void
): () => void {
  const q = query(
    collection(db, 'conversations', conversationId, 'messages'),
    where('participants', 'array-contains', uid),
    limit(150)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as ChatMessage);
      list.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, `conversations/${conversationId}/messages`)
  );
}

export async function sendChatMessage(
  conversation: Conversation,
  sender: UserProfile,
  text: string,
  mediaUrl = ''
): Promise<void> {
  const msgId = makeId('msg');
  const path = `conversations/${conversation.id}/messages/${msgId}`;
  try {
    const cleanText = (text.trim() || (mediaUrl ? 'Sent an attachment' : '')).slice(0, 2000);
    const batch = writeBatch(db);
    batch.set(doc(db, 'conversations', conversation.id, 'messages', msgId), {
      id: msgId,
      conversationId: conversation.id,
      senderId: sender.uid,
      senderName: sender.displayName.slice(0, 60),
      senderPhoto: sender.photoURL.slice(0, 2000),
      participants: conversation.participants,
      text: cleanText,
      mediaUrl: mediaUrl.slice(0, 2000),
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, 'conversations', conversation.id), {
      lastMessage: cleanText.slice(0, 500),
      lastSenderId: sender.uid,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();

    const recipients = conversation.participants.filter((p) => p !== sender.uid).slice(0, 5);
    for (const recipientId of recipients) {
      await createNotification({
        recipientId,
        actor: sender,
        type: 'message',
        postId: conversation.id,
        message: conversation.isGroup
          ? `${sender.displayName} in ${conversation.groupName}: ${cleanText.slice(0, 60)}`
          : `${sender.displayName}: ${cleanText.slice(0, 80)}`,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// Live Streaming + WebRTC Signaling
export function subscribeLiveStreams(onData: (streams: LiveStream[]) => void): () => void {
  const q = query(collection(db, 'liveStreams'), where('status', '==', 'live'), limit(30));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as LiveStream);
      list.sort((a, b) => toMillis(b.startedAt) - toMillis(a.startedAt));
      onData(list);
    },
    (error) => console.warn('Live streams listener warning:', error)
  );
}

export async function startLiveStream(
  host: UserProfile,
  title: string,
  notifyUids: string[]
): Promise<LiveStream> {
  const streamId = makeId('live');
  const stream: LiveStream = {
    id: streamId,
    hostId: host.uid,
    hostName: host.displayName.slice(0, 60),
    hostUsername: host.username.slice(0, 30),
    hostPhoto: host.photoURL.slice(0, 2000),
    title: title.trim().slice(0, 160) || `${host.displayName} is Live`,
    status: 'live',
    viewersCount: 0,
    reactionsCount: 0,
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'liveStreams', streamId), stream);
    for (const recipientId of notifyUids.slice(0, 20)) {
      if (recipientId !== host.uid) {
        await createNotification({
          recipientId,
          actor: host,
          type: 'live',
          postId: streamId,
          message: `${host.displayName} started a live video: "${stream.title}"`,
        });
      }
    }
    return stream;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `liveStreams/${streamId}`);
  }
}

export async function endLiveStream(streamId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'liveStreams', streamId), {
      status: 'ended',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `liveStreams/${streamId}`);
  }
}

export async function joinLiveStream(streamId: string, viewer: UserProfile): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'liveStreams', streamId, 'viewers', viewer.uid), {
      viewerId: viewer.uid,
      streamId,
      viewerName: viewer.displayName.slice(0, 60),
      joinedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'liveStreams', streamId), {
      viewersCount: increment(1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch {
    // Non-blocking join
  }
}

export async function leaveLiveStream(streamId: string, viewerId: string): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'liveStreams', streamId, 'viewers', viewerId));
    batch.update(doc(db, 'liveStreams', streamId), {
      viewersCount: increment(-1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch {
    // Non-blocking leave
  }
}

export function subscribeLiveComments(
  streamId: string,
  onData: (items: LiveComment[]) => void
): () => void {
  const q = query(
    collection(db, 'liveStreams', streamId, 'comments'),
    where('streamId', '==', streamId),
    limit(100)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as LiveComment);
      list.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
      onData(list);
    },
    (error) => console.warn('Live comments warning:', error)
  );
}

export async function sendLiveCommentOrReaction(
  streamId: string,
  author: UserProfile,
  text: string,
  kind: 'comment' | 'reaction'
): Promise<void> {
  const commentId = makeId('lc');
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'liveStreams', streamId, 'comments', commentId), {
      id: commentId,
      streamId,
      authorId: author.uid,
      authorName: author.displayName.slice(0, 60),
      authorPhoto: author.photoURL.slice(0, 2000),
      text: text.trim().slice(0, 300),
      kind,
      createdAt: serverTimestamp(),
    });
    if (kind === 'reaction') {
      batch.update(doc(db, 'liveStreams', streamId), {
        reactionsCount: increment(1),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `liveStreams/${streamId}/comments/${commentId}`);
  }
}

export async function sendWebRTCSignal(params: {
  streamId: string;
  fromUid: string;
  toUid: string;
  type: 'offer' | 'answer' | 'ice';
  payload: string;
}): Promise<void> {
  const signalId = makeId('sig');
  try {
    await setDoc(doc(db, 'liveStreams', params.streamId, 'signals', signalId), {
      id: signalId,
      streamId: params.streamId,
      fromUid: params.fromUid,
      toUid: params.toUid,
      type: params.type,
      payload: params.payload.slice(0, 16000),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn('Signal send warning:', error);
  }
}

export function subscribeWebRTCSignals(
  streamId: string,
  myUid: string,
  onSignal: (sig: WebRTCSignal) => void
): () => void {
  const q = query(
    collection(db, 'liveStreams', streamId, 'signals'),
    where('toUid', '==', myUid),
    limit(100)
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

// 1-to-1 Voice & Video Calls (WebRTC Signaling)
export async function createCallSession(params: {
  caller: UserProfile;
  callee: UserProfile;
  callType: 'audio' | 'video';
  offerSdp: string;
}): Promise<CallSession> {
  const callId = makeId('call');
  const session: CallSession = {
    id: callId,
    callerId: params.caller.uid,
    callerName: params.caller.displayName.slice(0, 60),
    callerPhoto: params.caller.photoURL.slice(0, 2000),
    calleeId: params.callee.uid,
    calleeName: params.callee.displayName.slice(0, 60),
    calleePhoto: params.callee.photoURL.slice(0, 2000),
    participants: [params.caller.uid, params.callee.uid],
    callType: params.callType,
    status: 'ringing',
    offerSdp: params.offerSdp.slice(0, 16000),
    answerSdp: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'calls', callId), session);
    await createNotification({
      recipientId: params.callee.uid,
      actor: params.caller,
      type: 'call',
      postId: callId,
      message: `Incoming ${params.callType} call from ${params.caller.displayName}`,
    });
    return session;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `calls/${callId}`);
  }
}

export function subscribeMyCalls(
  uid: string,
  onData: (calls: CallSession[]) => void
): () => void {
  const q = query(collection(db, 'calls'), where('participants', 'array-contains', uid), limit(20));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as CallSession);
      list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(list);
    },
    (error) => console.warn('Calls listener warning:', error)
  );
}

export function subscribeCallDoc(callId: string, onData: (call: CallSession | null) => void): () => void {
  return onSnapshot(doc(db, 'calls', callId), (snap) => {
    onData(snap.exists() ? (snap.data() as CallSession) : null);
  });
}

export async function updateCallSession(
  callId: string,
  updates: { status: CallSession['status']; answerSdp?: string }
): Promise<void> {
  try {
    await updateDoc(doc(db, 'calls', callId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `calls/${callId}`);
  }
}

export async function addCallCandidate(
  callId: string,
  senderId: string,
  participants: string[],
  candidate: string
): Promise<void> {
  const candidateId = makeId('ice');
  try {
    await setDoc(doc(db, 'calls', callId, 'candidates', candidateId), {
      id: candidateId,
      callId,
      senderId,
      participants,
      candidate: candidate.slice(0, 4000),
      createdAt: serverTimestamp(),
    });
  } catch {
    // Ignore transient ICE error
  }
}

export function subscribeCallCandidates(
  callId: string,
  myUid: string,
  onCandidate: (candidateJson: string) => void
): () => void {
  const q = query(
    collection(db, 'calls', callId, 'candidates'),
    where('participants', 'array-contains', myUid),
    limit(100)
  );
  return onSnapshot(q, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const data = change.doc.data() as { senderId: string; candidate: string };
        if (data.senderId !== myUid) {
          onCandidate(data.candidate);
        }
      }
    });
  });
}

export async function createNotification(params: {
  recipientId: string;
  actor: UserProfile;
  type: NotificationItem['type'];
  postId: string;
  message: string;
}): Promise<void> {
  const notifId = makeId('ntf');
  try {
    await setDoc(doc(db, 'notifications', notifId), {
      id: notifId,
      recipientId: params.recipientId,
      actorId: params.actor.uid,
      actorName: params.actor.displayName.slice(0, 60),
      actorPhoto: params.actor.photoURL.slice(0, 2000),
      type: params.type,
      postId: params.postId.slice(0, 128),
      message: params.message.slice(0, 300),
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn('Notification error:', error);
  }
}

export function subscribeNotifications(
  uid: string,
  onData: (items: NotificationItem[]) => void
): () => void {
  const q = query(collection(db, 'notifications'), where('recipientId', '==', uid), limit(60));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as NotificationItem);
      list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'notifications')
  );
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'notifications', notificationId), { read: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `notifications/${notificationId}`);
  }
}

export async function markAllNotificationsRead(items: NotificationItem[]): Promise<void> {
  const unread = items.filter((n) => !n.read);
  if (!unread.length) return;
  try {
    const batch = writeBatch(db);
    unread.slice(0, 400).forEach((n) => {
      batch.update(doc(db, 'notifications', n.id), { read: true });
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'notifications');
  }
}

export function subscribeBlocks(
  uid: string,
  onData: (blockedByMe: Set<string>, blockedMe: Set<string>) => void
): () => void {
  const qByMe = query(collection(db, 'blocks'), where('blockerId', '==', uid), limit(100));
  const qMe = query(collection(db, 'blocks'), where('blockedId', '==', uid), limit(100));

  let setByMe = new Set<string>();
  let setMe = new Set<string>();

  const unsub1 = onSnapshot(
    qByMe,
    (snap) => {
      setByMe = new Set(snap.docs.map((d) => (d.data() as BlockRecord).blockedId));
      onData(setByMe, setMe);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'blocks')
  );

  const unsub2 = onSnapshot(
    qMe,
    (snap) => {
      setMe = new Set(snap.docs.map((d) => (d.data() as BlockRecord).blockerId));
      onData(setByMe, setMe);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'blocks')
  );

  return () => {
    unsub1();
    unsub2();
  };
}

export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  const blockId = `${blockerId}_${blockedId}`;
  try {
    await setDoc(doc(db, 'blocks', blockId), {
      blockerId,
      blockedId,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `blocks/${blockId}`);
  }
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  const blockId = `${blockerId}_${blockedId}`;
  try {
    await deleteDoc(doc(db, 'blocks', blockId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `blocks/${blockId}`);
  }
}

export async function submitReport(params: {
  reporter: UserProfile;
  targetType: 'post' | 'user' | 'comment';
  targetId: string;
  targetOwnerId: string;
  reason: string;
  details: string;
}): Promise<void> {
  const reportId = makeId('rep');
  try {
    await setDoc(doc(db, 'reports', reportId), {
      id: reportId,
      reporterId: params.reporter.uid,
      reporterUsername: params.reporter.username.slice(0, 30),
      targetType: params.targetType,
      targetId: params.targetId,
      targetOwnerId: params.targetOwnerId,
      reason: params.reason.slice(0, 120),
      details: params.details.trim().slice(0, 1000),
      status: 'open',
      adminNotes: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `reports/${reportId}`);
  }
}

export function subscribeAdminReports(onData: (reports: ModerationReport[]) => void): () => void {
  const q = query(collection(db, 'reports'), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as ModerationReport);
      list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, 'reports')
  );
}

export async function fetchAllPostsForAdmin(): Promise<Post[]> {
  try {
    const snap = await getDocs(query(collection(db, 'posts'), limit(100)));
    const list = snap.docs.map((d) => d.data() as Post);
    list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'posts');
  }
}

export async function fetchAllUsersForAdmin(): Promise<UserProfile[]> {
  try {
    const snap = await getDocs(query(collection(db, 'users'), limit(100)));
    return snap.docs.map((d) => d.data() as UserProfile);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
  }
}

export async function adminUpdateReport(
  reportId: string,
  status: ModerationReport['status'],
  adminNotes: string
): Promise<void> {
  try {
    await updateDoc(doc(db, 'reports', reportId), {
      status,
      adminNotes: adminNotes.slice(0, 1000),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `reports/${reportId}`);
  }
}

export async function adminSetPostStatus(postId: string, status: 'active' | 'hidden'): Promise<void> {
  try {
    await updateDoc(doc(db, 'posts', postId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `posts/${postId}`);
  }
}

export async function adminSetUserSuspended(uid: string, isSuspended: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', uid), {
      isSuspended,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function adminDeletePost(postId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'posts', postId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `posts/${postId}`);
  }
}

export function subscribeActiveAnnouncements(onData: (items: Announcement[]) => void): () => void {
  const q = query(collection(db, 'announcements'), where('active', '==', true), limit(15));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as Announcement);
      list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(list);
    },
    (error) => console.warn('Announcements listener warning:', error)
  );
}

export async function fetchAllAnnouncementsAdmin(): Promise<Announcement[]> {
  try {
    const snap = await getDocs(query(collection(db, 'announcements'), limit(50)));
    const list = snap.docs.map((d) => d.data() as Announcement);
    list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'announcements');
  }
}

export async function createAnnouncement(params: {
  author: UserProfile;
  title: string;
  message: string;
  priority: 'normal' | 'important';
}): Promise<void> {
  const id = makeId('ann');
  try {
    await setDoc(doc(db, 'announcements', id), {
      id,
      title: params.title.trim().slice(0, 120),
      message: params.message.trim().slice(0, 1000),
      priority: params.priority,
      authorId: params.author.uid,
      authorName: params.author.displayName.slice(0, 60),
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `announcements/${id}`);
  }
}

export async function toggleAnnouncementActive(id: string, active: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, 'announcements', id), {
      active,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `announcements/${id}`);
  }
}

export async function deleteAnnouncement(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'announcements', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `announcements/${id}`);
  }
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  id: 'platform',
  maintenanceMode: false,
  allowNewRegistrations: true,
  allowLiveStreaming: true,
  allowVideoReels: true,
  allowAudioRooms: true,
  allowVirtualGifts: true,
  allowCoinPurchases: true,
  ownerUid: '',
  welcomeHeadline: 'Connect • Share • Chat • Make Friends',
  updatedBy: 'system',
};

export function subscribeAppSettings(onData: (settings: AppSettings) => void): () => void {
  return onSnapshot(
    doc(db, 'appSettings', 'platform'),
    (snap) => {
      if (snap.exists()) {
        onData({ ...DEFAULT_APP_SETTINGS, ...(snap.data() as AppSettings) });
      } else {
        onData(DEFAULT_APP_SETTINGS);
      }
    },
    (error) => console.warn('AppSettings listener warning:', error)
  );
}

export async function saveAppSettings(
  uid: string,
  settings: Omit<AppSettings, 'id' | 'updatedBy' | 'updatedAt'>
): Promise<void> {
  try {
    await setDoc(doc(db, 'appSettings', 'platform'), {
      id: 'platform',
      maintenanceMode: settings.maintenanceMode,
      allowNewRegistrations: settings.allowNewRegistrations,
      allowLiveStreaming: settings.allowLiveStreaming,
      allowVideoReels: settings.allowVideoReels,
      allowAudioRooms: settings.allowAudioRooms ?? true,
      allowVirtualGifts: settings.allowVirtualGifts ?? true,
      allowCoinPurchases: settings.allowCoinPurchases ?? true,
      ownerUid: (settings.ownerUid || uid).slice(0, 128),
      welcomeHeadline: settings.welcomeHeadline.trim().slice(0, 160),
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'appSettings/platform');
  }
}

export interface ResolvedAdminCandidate {
  uid: string;
  displayName: string;
  username: string;
  email: string;
  photoURL: string;
  isVerified: boolean;
  isSuspended: boolean;
  isProtectedOwner?: boolean;
}

export interface AdminLookupResponse {
  user: ResolvedAdminCandidate;
  existingAdmin: AdminRecord | null;
  currentRole: 'super_admin_owner' | 'admin' | 'moderator' | 'user';
  isProtectedOwner: boolean;
}

async function getOwnerAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Sign in with the Original Owner account first.');
  }
  const token = await user.getIdToken(forceRefresh);
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function parseJsonSafe<T>(resp: Response): Promise<{ parsed: T | null; rawText: string }> {
  const rawText = await resp.text().catch(() => '');
  if (!rawText) return { parsed: null, rawText: '' };
  try {
    return { parsed: JSON.parse(rawText) as T, rawText };
  } catch {
    return { parsed: null, rawText };
  }
}

export async function ownerFetchAdminsBackend(): Promise<AdminRecord[]> {
  let headers = await getOwnerAuthHeaders(false);
  let resp = await fetch('/api/owner/admins', { method: 'GET', headers });
  if (resp.status === 401) {
    headers = await getOwnerAuthHeaders(true);
    resp = await fetch('/api/owner/admins', { method: 'GET', headers });
  }
  const { parsed, rawText } = await parseJsonSafe<{ admins?: AdminRecord[]; error?: string }>(resp);
  if (!resp.ok) {
    throw new Error(
      parsed?.error ||
        `Unable to verify owner session to load Admin team (HTTP ${resp.status})${
          rawText ? `: ${rawText.slice(0, 120)}` : ''
        }`
    );
  }
  return parsed?.admins || [];
}

export async function ownerLookupUserForAdmin(identifier: string): Promise<AdminLookupResponse> {
  const cleanIdentifier = identifier.trim();
  if (!cleanIdentifier) {
    throw new Error('Please enter a registered user email address or Firebase UID.');
  }

  const doRequest = async (forceRefresh: boolean) => {
    const headers = await getOwnerAuthHeaders(forceRefresh);
    return fetch('/api/owner/admins/lookup', {
      method: 'POST',
      headers,
      body: JSON.stringify({ identifier: cleanIdentifier }),
    });
  };

  let resp: Response;
  try {
    resp = await doRequest(false);
    if (resp.status === 401) {
      resp = await doRequest(true);
    }
  } catch (networkErr) {
    const msg = networkErr instanceof Error ? networkErr.message : 'Network error reaching backend.';
    throw new Error(`Could not reach lookup service (/api/owner/admins/lookup): ${msg}`);
  }

  const { parsed, rawText } = await parseJsonSafe<{
    user?: ResolvedAdminCandidate;
    existingAdmin?: AdminRecord | null;
    currentRole?: 'super_admin_owner' | 'admin' | 'moderator' | 'user';
    isProtectedOwner?: boolean;
    error?: string;
  }>(resp);

  if (!resp.ok || !parsed?.user) {
    throw new Error(
      parsed?.error ||
        `User lookup failed (HTTP ${resp.status})${rawText ? `: ${rawText.slice(0, 140)}` : ''}`
    );
  }

  const existingAdmin = parsed.existingAdmin || null;
  const isProtectedOwner = Boolean(parsed.isProtectedOwner || parsed.user.isProtectedOwner);
  const currentRole =
    parsed.currentRole ||
    (isProtectedOwner
      ? 'super_admin_owner'
      : existingAdmin
      ? existingAdmin.role === 'admin'
        ? 'admin'
        : 'moderator'
      : 'user');

  return {
    user: parsed.user,
    existingAdmin,
    currentRole,
    isProtectedOwner,
  };
}

export async function ownerCreateAdminOrModerator(params: {
  identifier: string;
  role: 'admin' | 'moderator';
  notes?: string;
}): Promise<AdminRecord> {
  const headers = await getOwnerAuthHeaders();
  const resp = await fetch('/api/owner/admins', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = (await resp.json().catch(() => ({}))) as { admin?: AdminRecord; error?: string };
  if (!resp.ok || !data.admin) {
    throw new Error(data.error || 'Failed to create Admin or Moderator account.');
  }
  return data.admin;
}

export async function ownerUpdateAdminStatusOrRole(
  targetUid: string,
  patch: { role?: 'admin' | 'moderator'; isSuspended?: boolean; notes?: string }
): Promise<void> {
  const headers = await getOwnerAuthHeaders();
  const resp = await fetch(`/api/owner/admins/${encodeURIComponent(targetUid)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
  const data = (await resp.json().catch(() => ({}))) as { error?: string };
  if (!resp.ok) {
    throw new Error(data.error || 'Failed to update Admin or Moderator account.');
  }
}

export async function ownerRemoveAdminOrModerator(targetUid: string): Promise<void> {
  const headers = await getOwnerAuthHeaders();
  const resp = await fetch(`/api/owner/admins/${encodeURIComponent(targetUid)}`, {
    method: 'DELETE',
    headers,
  });
  const data = (await resp.json().catch(() => ({}))) as { error?: string };
  if (!resp.ok) {
    throw new Error(data.error || 'Failed to remove Admin or Moderator account.');
  }
}

export async function fetchAdminRecords(): Promise<AdminRecord[]> {
  try {
    return await ownerFetchAdminsBackend();
  } catch {
    try {
      const snap = await getDocs(query(collection(db, 'admins'), limit(50)));
      return snap.docs.map((d) => d.data() as AdminRecord);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'admins');
    }
  }
}

export async function grantAdminRole(
  targetUid: string,
  grantedBy: string,
  role: 'admin' | 'moderator' = 'admin',
  displayName = '',
  notes = '',
  email = ''
): Promise<void> {
  try {
    await setDoc(doc(db, 'admins', targetUid), {
      uid: targetUid,
      grantedBy,
      role,
      isSuspended: false,
      displayName: displayName.slice(0, 60),
      email: email.slice(0, 120),
      notes: notes.slice(0, 300),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `admins/${targetUid}`);
  }
}

export async function updateAdminRecord(
  targetUid: string,
  updates: { role?: 'admin' | 'moderator'; isSuspended?: boolean; notes?: string }
): Promise<void> {
  try {
    await updateDoc(doc(db, 'admins', targetUid), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `admins/${targetUid}`);
  }
}

export async function revokeAdminRole(targetUid: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'admins', targetUid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `admins/${targetUid}`);
  }
}

export async function adminSetUserVerified(uid: string, isVerified: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', uid), {
      isVerified,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

// Personal Data Export & Permanent Account Deletion
export async function exportMyUserData(uid: string): Promise<Record<string, unknown>> {
  const [userSnap, privSnap, postsSnap, storiesSnap, savedSnap, ticketsSnap] = await Promise.all([
    getDoc(doc(db, 'users', uid)),
    getDoc(doc(db, 'users', uid, 'private', 'info')).catch(() => null),
    getDocs(query(collection(db, 'posts'), where('authorId', '==', uid), limit(100))),
    getDocs(query(collection(db, 'stories'), where('authorId', '==', uid), limit(50))).catch(() => null),
    getDocs(query(collection(db, 'users', uid, 'savedPosts'), limit(100))).catch(() => null),
    getDocs(query(collection(db, 'supportTickets'), where('userId', '==', uid), limit(50))).catch(() => null),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    platform: 'BANDHU MELA',
    publicProfile: userSnap.exists() ? userSnap.data() : null,
    privateInfo: privSnap && privSnap.exists() ? privSnap.data() : null,
    posts: postsSnap.docs.map((d) => d.data()),
    stories: storiesSnap ? storiesSnap.docs.map((d) => d.data()) : [],
    savedPosts: savedSnap ? savedSnap.docs.map((d) => d.data()) : [],
    supportTickets: ticketsSnap ? ticketsSnap.docs.map((d) => d.data()) : [],
  };
}

export async function deleteMyAccountAndData(authUser: User): Promise<void> {
  const uid = authUser.uid;
  try {
    const [postsSnap, storiesSnap, savedSnap, notifsSnap, followsSnap] = await Promise.all([
      getDocs(query(collection(db, 'posts'), where('authorId', '==', uid), limit(100))),
      getDocs(query(collection(db, 'stories'), where('authorId', '==', uid), limit(50))),
      getDocs(query(collection(db, 'users', uid, 'savedPosts'), limit(100))),
      getDocs(query(collection(db, 'notifications'), where('recipientId', '==', uid), limit(100))),
      getDocs(query(collection(db, 'follows'), where('followerId', '==', uid), limit(100))),
    ]);

    const batch = writeBatch(db);
    postsSnap.docs.forEach((d) => batch.delete(d.ref));
    storiesSnap.docs.forEach((d) => batch.delete(d.ref));
    savedSnap.docs.forEach((d) => batch.delete(d.ref));
    notifsSnap.docs.forEach((d) => batch.delete(d.ref));
    followsSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, 'presence', uid));
    batch.delete(doc(db, 'users', uid, 'private', 'info'));
    batch.delete(doc(db, 'users', uid));
    await batch.commit();

    await deleteUser(authUser);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('requires-recent-login')) {
      throw new Error('For security, please sign out and sign back in right before permanently deleting your account.');
    }
    throw error;
  }
}

// Help Center & Support Tickets
export function subscribeMySupportTickets(
  uid: string,
  onData: (tickets: SupportTicket[]) => void
): () => void {
  const q = query(collection(db, 'supportTickets'), where('userId', '==', uid), limit(50));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as SupportTicket);
      list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(list);
    },
    (error) => console.warn('Support ticket listener warning:', error)
  );
}

export async function fetchAllSupportTicketsAdmin(): Promise<SupportTicket[]> {
  try {
    const snap = await getDocs(query(collection(db, 'supportTickets'), limit(100)));
    const list = snap.docs.map((d) => d.data() as SupportTicket);
    list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'supportTickets');
  }
}

export async function createSupportTicket(params: {
  user: UserProfile;
  category: string;
  subject: string;
  message: string;
}): Promise<void> {
  checkSpamGuard(`ticket:${params.user.uid}`, `${params.subject} ${params.message}`, 4000);
  const id = makeId('tkt');
  try {
    await setDoc(doc(db, 'supportTickets', id), {
      id,
      userId: params.user.uid,
      username: params.user.username.slice(0, 30),
      category: params.category.slice(0, 60),
      subject: params.subject.trim().slice(0, 140),
      message: params.message.trim().slice(0, 1500),
      status: 'open',
      adminReply: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `supportTickets/${id}`);
  }
}

export async function adminReplySupportTicket(
  ticketId: string,
  status: SupportTicket['status'],
  adminReply: string
): Promise<void> {
  try {
    await updateDoc(doc(db, 'supportTickets', ticketId), {
      status,
      adminReply: adminReply.trim().slice(0, 1000),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `supportTickets/${ticketId}`);
  }
}

// Groups & Communities
export function subscribeCommunities(onData: (items: Community[]) => void): () => void {
  const q = query(collection(db, 'communities'), where('membersCount', '>=', 0), limit(60));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as Community);
      list.sort((a, b) => b.membersCount - a.membersCount || toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(list);
    },
    (error) => console.warn('Communities listener warning:', error)
  );
}

export async function createCommunity(params: {
  creator: UserProfile;
  name: string;
  description: string;
  category: string;
  coverUrl: string;
}): Promise<string> {
  checkSpamGuard(`community:${params.creator.uid}`, `${params.name} ${params.description}`, 4000);
  const communityId = makeId('grp');
  try {
    await setDoc(doc(db, 'communities', communityId), {
      id: communityId,
      name: params.name.trim().slice(0, 80),
      description: params.description.trim().slice(0, 500),
      category: params.category.trim().slice(0, 50) || 'General',
      coverUrl: (params.coverUrl.trim() || DEFAULT_COVER_BANNER).slice(0, 2000),
      creatorId: params.creator.uid,
      creatorName: params.creator.displayName.slice(0, 60),
      membersCount: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'communities', communityId, 'members', params.creator.uid), {
      userId: params.creator.uid,
      communityId,
      displayName: params.creator.displayName.slice(0, 60),
      photoURL: params.creator.photoURL.slice(0, 2000),
      role: 'admin',
      joinedAt: serverTimestamp(),
    });
    return communityId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `communities/${communityId}`);
  }
}

export function subscribeCommunityMembers(
  communityId: string,
  onData: (members: CommunityMember[]) => void
): () => void {
  const q = query(collection(db, 'communities', communityId, 'members'), where('communityId', '==', communityId), limit(100));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as CommunityMember)),
    (error) => console.warn('Community members warning:', error)
  );
}

export async function toggleJoinCommunity(
  communityId: string,
  user: UserProfile,
  isMember: boolean
): Promise<boolean> {
  try {
    const memberRef = doc(db, 'communities', communityId, 'members', user.uid);
    const commRef = doc(db, 'communities', communityId);
    const batch = writeBatch(db);
    if (isMember) {
      batch.delete(memberRef);
      batch.update(commRef, { membersCount: increment(-1), updatedAt: serverTimestamp() });
    } else {
      batch.set(memberRef, {
        userId: user.uid,
        communityId,
        displayName: user.displayName.slice(0, 60),
        photoURL: user.photoURL.slice(0, 2000),
        role: 'member',
        joinedAt: serverTimestamp(),
      });
      batch.update(commRef, { membersCount: increment(1), updatedAt: serverTimestamp() });
    }
    await batch.commit();
    return !isMember;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `communities/${communityId}/members/${user.uid}`);
  }
}

export function subscribeCommunityPosts(
  communityId: string,
  onData: (posts: CommunityPost[]) => void
): () => void {
  const q = query(collection(db, 'communities', communityId, 'posts'), where('communityId', '==', communityId), limit(80));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as CommunityPost);
      list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(list);
    },
    (error) => console.warn('Community posts warning:', error)
  );
}

export async function createCommunityPost(params: {
  communityId: string;
  author: UserProfile;
  text: string;
  mediaUrl?: string;
}): Promise<void> {
  checkSpamGuard(`cpost:${params.author.uid}`, params.text, 2500);
  const postId = makeId('cpst');
  try {
    await setDoc(doc(db, 'communities', params.communityId, 'posts', postId), {
      id: postId,
      communityId: params.communityId,
      authorId: params.author.uid,
      authorName: params.author.displayName.slice(0, 60),
      authorPhoto: params.author.photoURL.slice(0, 2000),
      text: params.text.trim().slice(0, 1500),
      mediaUrl: (params.mediaUrl || '').trim().slice(0, 2000),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `communities/${params.communityId}/posts/${postId}`);
  }
}

// Events & RSVP Participation
export function subscribeEvents(onData: (items: SocialEvent[]) => void): () => void {
  const q = query(collection(db, 'events'), where('attendeesCount', '>=', 0), limit(60));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as SocialEvent);
      list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(list);
    },
    (error) => console.warn('Events listener warning:', error)
  );
}

export async function createSocialEvent(params: {
  host: UserProfile;
  title: string;
  description: string;
  location: string;
  eventDate: string;
  coverUrl: string;
}): Promise<string> {
  checkSpamGuard(`event:${params.host.uid}`, `${params.title} ${params.description}`, 4000);
  const eventId = makeId('evt');
  try {
    await setDoc(doc(db, 'events', eventId), {
      id: eventId,
      title: params.title.trim().slice(0, 120),
      description: params.description.trim().slice(0, 1000),
      location: params.location.trim().slice(0, 140),
      eventDate: params.eventDate.trim().slice(0, 60),
      coverUrl: (params.coverUrl.trim() || DEFAULT_COVER_BANNER).slice(0, 2000),
      hostId: params.host.uid,
      hostName: params.host.displayName.slice(0, 60),
      attendeesCount: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'events', eventId, 'rsvps', params.host.uid), {
      userId: params.host.uid,
      eventId,
      displayName: params.host.displayName.slice(0, 60),
      status: 'going',
      updatedAt: serverTimestamp(),
    });
    return eventId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `events/${eventId}`);
  }
}

export function subscribeEventRsvps(
  eventId: string,
  onData: (rsvps: EventRsvp[]) => void
): () => void {
  const q = query(collection(db, 'events', eventId, 'rsvps'), where('eventId', '==', eventId), limit(100));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as EventRsvp)),
    (error) => console.warn('Event RSVP warning:', error)
  );
}

export async function rsvpEvent(
  eventId: string,
  user: UserProfile,
  nextStatus: 'going' | 'interested' | 'cancel',
  alreadyHadRsvp: boolean
): Promise<void> {
  try {
    const rsvpRef = doc(db, 'events', eventId, 'rsvps', user.uid);
    const eventRef = doc(db, 'events', eventId);
    const batch = writeBatch(db);
    if (nextStatus === 'cancel') {
      batch.delete(rsvpRef);
      if (alreadyHadRsvp) {
        batch.update(eventRef, { attendeesCount: increment(-1), updatedAt: serverTimestamp() });
      }
    } else {
      batch.set(rsvpRef, {
        userId: user.uid,
        eventId,
        displayName: user.displayName.slice(0, 60),
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      if (!alreadyHadRsvp) {
        batch.update(eventRef, { attendeesCount: increment(1), updatedAt: serverTimestamp() });
      }
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `events/${eventId}/rsvps/${user.uid}`);
  }
}

// Owner Database JSON Backup & Recovery
export async function exportFullBackupJson(): Promise<Record<string, unknown>> {
  const [users, posts, announcements, settings, reports, tickets, communities, events] = await Promise.all([
    fetchAllUsersForAdmin(),
    fetchAllPostsForAdmin(),
    fetchAllAnnouncementsAdmin(),
    getDoc(doc(db, 'appSettings', 'platform')),
    getDocs(query(collection(db, 'reports'), limit(100))),
    fetchAllSupportTicketsAdmin(),
    getDocs(query(collection(db, 'communities'), limit(100))),
    getDocs(query(collection(db, 'events'), limit(100))),
  ]);

  return {
    backupVersion: '1.0',
    platform: 'BANDHU MELA',
    exportedAt: new Date().toISOString(),
    appSettings: settings.exists() ? settings.data() : DEFAULT_APP_SETTINGS,
    users,
    posts,
    announcements,
    reports: reports.docs.map((d) => d.data()),
    supportTickets: tickets,
    communities: communities.docs.map((d) => d.data()),
    events: events.docs.map((d) => d.data()),
  };
}

export async function restoreBackupJson(
  adminUid: string,
  payload: Record<string, unknown>
): Promise<{ restoredItems: number }> {
  let restoredItems = 0;
  if (payload.appSettings && typeof payload.appSettings === 'object') {
    const s = payload.appSettings as Partial<AppSettings>;
    await saveAppSettings(adminUid, {
      maintenanceMode: Boolean(s.maintenanceMode),
      allowNewRegistrations: s.allowNewRegistrations ?? true,
      allowLiveStreaming: s.allowLiveStreaming ?? true,
      allowVideoReels: s.allowVideoReels ?? true,
      welcomeHeadline: typeof s.welcomeHeadline === 'string' ? s.welcomeHeadline : DEFAULT_APP_SETTINGS.welcomeHeadline,
    });
    restoredItems += 1;
  }

  if (Array.isArray(payload.announcements)) {
    for (const item of payload.announcements.slice(0, 20)) {
      const a = item as Partial<Announcement>;
      if (a.id && a.title && a.message) {
        await setDoc(doc(db, 'announcements', a.id), {
          id: a.id,
          title: String(a.title).slice(0, 120),
          message: String(a.message).slice(0, 1000),
          priority: a.priority === 'important' ? 'important' : 'normal',
          authorId: adminUid,
          authorName: String(a.authorName || 'Owner').slice(0, 60),
          active: Boolean(a.active),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        restoredItems += 1;
      }
    }
  }

  if (Array.isArray(payload.posts)) {
    for (const item of payload.posts.slice(0, 30)) {
      const p = item as Partial<Post>;
      if (p.id && p.authorId === adminUid && p.authorName && p.authorUsername) {
        await setDoc(doc(db, 'posts', p.id), {
          id: p.id,
          authorId: adminUid,
          authorName: String(p.authorName).slice(0, 60),
          authorUsername: String(p.authorUsername).slice(0, 30),
          authorPhoto: String(p.authorPhoto || DEFAULT_AVATAR).slice(0, 2000),
          caption: String(p.caption || '').slice(0, 2200),
          hashtags: Array.isArray(p.hashtags) ? p.hashtags.slice(0, 15) : [],
          mediaUrl: String(p.mediaUrl || '').slice(0, 2000),
          mediaType: p.mediaType || 'text',
          aspectRatio: p.aspectRatio || '4:3',
          likesCount: 0,
          commentsCount: 0,
          sharesCount: 0,
          status: p.status === 'hidden' ? 'hidden' : 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        restoredItems += 1;
      }
    }
  }

  return { restoredItems };
}
