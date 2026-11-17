import React, { useState } from 'react';
import {
  Check,
  MessageCircle,
  Phone,
  Search,
  UserCheck,
  UserMinus,
  UserPlus,
  Video,
  X,
} from 'lucide-react';
import { t } from '../lib/i18n';
import {
  removeFriendRequest,
  respondFriendRequest,
  sendFriendRequest,
  toggleFollowUser,
} from '../lib/socialApi';
import {
  FriendRequest,
  LanguageCode,
  Post,
  UserPresence,
  UserProfile,
} from '../types/social';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';

interface FriendsViewProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  allPosts: Post[];
  presenceMap: Record<string, UserPresence>;
  followingIds: Set<string>;
  friendRequests: FriendRequest[];
  blockedIds: Set<string>;
  lang: LanguageCode;
  onOpenChatWith: (uid: string) => void;
  onStartCall: (peer: UserProfile, callType: 'audio' | 'video') => void;
  onSelectUser: (uid: string) => void;
  onSelectHashtag: (tag: string) => void;
  onOpenReels: () => void;
  onToast: (msg: string) => void;
}

export const FriendsView: React.FC<FriendsViewProps> = ({
  currentUser,
  allUsers,
  allPosts,
  presenceMap,
  followingIds,
  friendRequests,
  blockedIds,
  lang,
  onOpenChatWith,
  onStartCall,
  onSelectUser,
  onSelectHashtag,
  onOpenReels,
  onToast,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [section, setSection] = useState<'people' | 'requests' | 'search'>('people');

  const q = searchQuery.trim().toLowerCase();

  const visibleUsers = allUsers.filter((u) => u.uid !== currentUser.uid && !blockedIds.has(u.uid));
  const incomingPending = friendRequests.filter(
    (r) => r.receiverId === currentUser.uid && r.status === 'pending'
  );
  const outgoingPending = friendRequests.filter(
    (r) => r.senderId === currentUser.uid && r.status === 'pending'
  );
  const acceptedRequests = friendRequests.filter((r) => r.status === 'accepted');
  const friendUids = new Set(
    acceptedRequests.map((r) => (r.senderId === currentUser.uid ? r.receiverId : r.senderId))
  );

  const getReqBetween = (otherUid: string) =>
    friendRequests.find(
      (r) =>
        (r.senderId === currentUser.uid && r.receiverId === otherUid) ||
        (r.senderId === otherUid && r.receiverId === currentUser.uid)
    );

  const matchedUsers = q
    ? visibleUsers.filter(
        (u) =>
          u.displayName.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q) ||
          u.location.toLowerCase().includes(q) ||
          u.workOrBioTag.toLowerCase().includes(q)
      )
    : visibleUsers;

  const matchedPosts = q
    ? allPosts.filter(
        (p) =>
          !blockedIds.has(p.authorId) &&
          (p.caption.toLowerCase().includes(q) ||
            p.authorName.toLowerCase().includes(q) ||
            p.hashtags.some((h) => h.toLowerCase().includes(q)))
      )
    : [];

  const matchedHashtags = Array.from(
    new Set(
      allPosts
        .flatMap((p) => p.hashtags)
        .filter((tag) => (!q ? true : tag.toLowerCase().includes(q)))
    )
  ).slice(0, 16);

  return (
    <div className="space-y-6">
      {/* Unified Search Bar (Users, Posts, #Hashtags, Videos) */}
      <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-4">
        <div className="relative">
          <Search className="w-4 h-4 text-zinc-400 absolute left-4 top-3.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value.trim()) setSection('search');
            }}
            placeholder={t(lang, 'searchPlaceholder')}
            className="w-full h-11 pl-11 pr-4 rounded-2xl bg-[#F7F5F0] dark:bg-[#0E1113] border border-[#E4DFD5] dark:border-[#262C30] text-sm focus:outline-none focus:ring-2 focus:ring-[#0D6E6E]/30"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSection('people')}
            className={`h-9 px-4 rounded-xl text-xs font-semibold cursor-pointer ${
              section === 'people'
                ? 'bg-[#0D6E6E] text-white'
                : 'bg-[#F7F5F0] dark:bg-[#0E1113] text-zinc-600 dark:text-zinc-400'
            }`}
          >
            Circle &amp; Discover ({visibleUsers.length})
          </button>
          <button
            type="button"
            onClick={() => setSection('requests')}
            className={`h-9 px-4 rounded-xl text-xs font-semibold cursor-pointer ${
              section === 'requests'
                ? 'bg-[#0D6E6E] text-white'
                : 'bg-[#F7F5F0] dark:bg-[#0E1113] text-zinc-600 dark:text-zinc-400'
            }`}
          >
            Friend Requests ({incomingPending.length})
          </button>
          <button
            type="button"
            onClick={() => setSection('search')}
            className={`h-9 px-4 rounded-xl text-xs font-semibold cursor-pointer ${
              section === 'search'
                ? 'bg-[#0D6E6E] text-white'
                : 'bg-[#F7F5F0] dark:bg-[#0E1113] text-zinc-600 dark:text-zinc-400'
            }`}
          >
            Search Posts &amp; #Tags
          </button>
        </div>
      </div>

      {/* Friend Requests Section */}
      {(section === 'requests' || (section === 'people' && incomingPending.length > 0)) && (
        <section className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-4">
          <h3 className="font-display text-base font-bold">
            Incoming Friend Requests ({incomingPending.length})
          </h3>
          {incomingPending.length === 0 ? (
            <p className="text-sm text-zinc-500">No pending friend requests right now.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {incomingPending.map((req) => (
                <div
                  key={req.id}
                  className="p-4 rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between gap-3"
                >
                  <button
                    type="button"
                    onClick={() => onSelectUser(req.senderId)}
                    className="flex items-center gap-3 text-left min-w-0 cursor-pointer"
                  >
                    <Avatar src={req.senderPhoto} name={req.senderName} size="md" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{req.senderName}</p>
                      <p className="text-xs text-zinc-500 truncate">@{req.senderUsername}</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        await respondFriendRequest(req, currentUser, 'accepted');
                        onToast(`You and ${req.senderName} are now friends`);
                      }}
                      className="h-10 px-3.5 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{t(lang, 'accept')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => respondFriendRequest(req, currentUser, 'declined')}
                      className="h-10 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-medium cursor-pointer"
                    >
                      {t(lang, 'decline')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {outgoingPending.length > 0 && (
            <div className="pt-3 border-t border-[#E4DFD5] dark:border-[#262C30] space-y-2">
              <p className="text-xs font-semibold text-zinc-500">Sent Requests ({outgoingPending.length})</p>
              <div className="flex flex-wrap gap-2">
                {outgoingPending.map((req) => (
                  <div
                    key={req.id}
                    className="px-3 py-2 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] flex items-center gap-2 text-xs"
                  >
                    <span>{req.receiverName}</span>
                    <button
                      type="button"
                      onClick={() => removeFriendRequest(req.id)}
                      className="text-zinc-400 hover:text-red-500 cursor-pointer"
                      aria-label="Cancel friend request"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Search Results for Hashtags, Posts, Videos */}
      {section === 'search' && (
        <section className="space-y-4">
          {matchedHashtags.length > 0 && (
            <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-3">
              <h3 className="font-display text-sm font-bold">Trending Hashtags</h3>
              <div className="flex flex-wrap gap-2">
                {matchedHashtags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => onSelectHashtag(tag)}
                    className="h-9 px-3.5 rounded-xl bg-[#F7F5F0] dark:bg-[#0E1113] border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold text-[#0D6E6E] dark:text-teal-400 hover:border-[#0D6E6E] cursor-pointer"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-3">
            <h3 className="font-display text-sm font-bold">
              Matching Posts &amp; Videos ({matchedPosts.length})
            </h3>
            {!q ? (
              <p className="text-xs text-zinc-500">Type in the search box above to find posts, captions, or reels.</p>
            ) : matchedPosts.length === 0 ? (
              <p className="text-xs text-zinc-500">No posts matched &quot;{searchQuery}&quot;.</p>
            ) : (
              <div className="space-y-3">
                {matchedPosts.slice(0, 15).map((p) => (
                  <div
                    key={p.id}
                    className="p-3.5 rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold">
                        {p.authorName} · {p.mediaType.toUpperCase()}
                      </p>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{p.caption}</p>
                    </div>
                    {p.mediaType === 'reel' ? (
                      <button
                        type="button"
                        onClick={onOpenReels}
                        className="h-9 px-3 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold shrink-0 cursor-pointer"
                      >
                        Watch Reel
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelectUser(p.authorId)}
                        className="h-9 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold shrink-0 cursor-pointer"
                      >
                        View Author
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* People Directory */}
      <section className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold">
            {q ? `People matching "${searchQuery}"` : 'Friends & Community'} ({matchedUsers.length})
          </h3>
          <span className="text-xs text-zinc-500 tabular-nums">{friendUids.size} friends</span>
        </div>

        {matchedUsers.length === 0 ? (
          <p className="text-sm text-zinc-500 py-6 text-center">No members found.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {matchedUsers.map((person) => {
              const req = getReqBetween(person.uid);
              const isFriend = friendUids.has(person.uid);
              const isFollowing = followingIds.has(person.uid);
              const isOnline = person.showOnlineStatus !== false && presenceMap[person.uid]?.isOnline;

              return (
                <div
                  key={person.uid}
                  className="p-4 rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] flex flex-col justify-between gap-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => onSelectUser(person.uid)}
                      className="flex items-center gap-3 text-left min-w-0 cursor-pointer"
                    >
                      <div className="relative shrink-0">
                        <Avatar src={person.photoURL} name={person.displayName} size="md" />
                        {isOnline && (
                          <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#171B1E]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate flex items-center gap-1.5">
                          <span>{person.displayName}</span>
                          {person.isVerified && <VerifiedBadge className="w-4 h-4" />}
                        </p>
                        <p className="text-xs text-zinc-500 truncate">
                          @{person.username}
                          {person.location ? ` · ${person.location}` : ''}
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleFollowUser(currentUser, person.uid, isFollowing)}
                      className={`h-9 px-3 rounded-xl text-xs font-semibold shrink-0 cursor-pointer ${
                        isFollowing
                          ? 'border border-[#E4DFD5] dark:border-[#262C30]'
                          : 'bg-[#0D6E6E]/10 text-[#0D6E6E] dark:text-teal-300'
                      }`}
                    >
                      {isFollowing ? t(lang, 'following') : t(lang, 'follow')}
                    </button>
                  </div>

                  {person.bio && (
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">{person.bio}</p>
                  )}

                  <div className="flex items-center gap-2">
                    {isFriend ? (
                      <button
                        type="button"
                        onClick={async () => {
                          if (req) await removeFriendRequest(req.id);
                          onToast(`Removed ${person.displayName} from friends`);
                        }}
                        className="h-9 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <UserCheck className="w-3.5 h-3.5 text-[#0D6E6E]" />
                        <span>Friends</span>
                      </button>
                    ) : req && req.status === 'pending' && req.senderId === currentUser.uid ? (
                      <button
                        type="button"
                        onClick={() => removeFriendRequest(req.id)}
                        className="h-9 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                        <span>{t(lang, 'cancelRequest')}</span>
                      </button>
                    ) : req && req.status === 'pending' && req.receiverId === currentUser.uid ? (
                      <button
                        type="button"
                        onClick={() => respondFriendRequest(req, currentUser, 'accepted')}
                        className="h-9 px-3 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{t(lang, 'accept')}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={async () => {
                          await sendFriendRequest(currentUser, person);
                          onToast(`Friend request sent to ${person.displayName}`);
                        }}
                        className="h-9 px-3 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>{t(lang, 'addFriend')}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onOpenChatWith(person.uid)}
                      className="h-9 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>{t(lang, 'message')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onStartCall(person, 'audio')}
                      aria-label="Audio call"
                      className="w-9 h-9 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-center cursor-pointer"
                    >
                      <Phone className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onStartCall(person, 'video')}
                      aria-label="Video call"
                      className="w-9 h-9 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-center cursor-pointer"
                    >
                      <Video className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
