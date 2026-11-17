import React, { useEffect, useState } from 'react';
import {
  Bookmark,
  ChevronDown,
  ChevronUp,
  Film,
  Heart,
  MessageCircle,
  Plus,
  Share2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { t } from '../lib/i18n';
import {
  checkUserLikedPost,
  formatRelativeTime,
  incrementPostShare,
  toggleFollowUser,
  toggleLikePost,
  toggleSavePost,
} from '../lib/socialApi';
import { LanguageCode, Post, UserProfile } from '../types/social';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';

interface ReelsViewProps {
  reels: Post[];
  currentUser: UserProfile;
  followingIds: Set<string>;
  savedIds: Set<string>;
  verifiedUserIds?: Set<string>;
  allowVideoReels: boolean;
  lang: LanguageCode;
  onOpenComments: (post: Post) => void;
  onOpenCreateReel: () => void;
  onSelectUser: (uid: string) => void;
  onToast: (msg: string) => void;
}

export const ReelsView: React.FC<ReelsViewProps> = ({
  reels,
  currentUser,
  followingIds,
  savedIds,
  verifiedUserIds,
  allowVideoReels,
  lang,
  onOpenComments,
  onOpenCreateReel,
  onSelectUser,
  onToast,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});

  const activeReel = reels[activeIndex] || reels[0];

  useEffect(() => {
    if (!activeReel) return;
    void checkUserLikedPost(activeReel.id, currentUser.uid)
      .then((res) => setLikedMap((prev) => ({ ...prev, [activeReel.id]: res })))
      .catch(() => {});
  }, [activeReel, currentUser.uid]);

  if (reels.length === 0) {
    return (
      <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-10 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-[#0D6E6E]/10 text-[#0D6E6E] dark:text-teal-400 flex items-center justify-center mx-auto">
          <Film className="w-7 h-7" />
        </div>
        <h2 className="font-display text-2xl font-bold">Cinema Strip · Reels</h2>
        <p className="text-sm text-zinc-500 max-w-md mx-auto">
          Short vertical video stories from the BANDHU MELA community appear here.
        </p>
        {allowVideoReels && (
          <button
            type="button"
            onClick={onOpenCreateReel}
            className="h-11 px-6 rounded-xl bg-[#0D6E6E] text-white text-sm font-semibold hover:bg-[#095454] inline-flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Upload First Reel</span>
          </button>
        )}
      </div>
    );
  }

  const isVideoFile = Boolean(
    activeReel.mediaUrl.match(/\.(mp4|webm|mov)(\?|$)/i) || activeReel.mediaUrl.startsWith('/uploads/')
  );
  const liked = Boolean(likedMap[activeReel.id]);
  const isSaved = savedIds.has(activeReel.id);
  const isFollowing = followingIds.has(activeReel.authorId);

  const handleLike = async () => {
    const next = await toggleLikePost(activeReel, currentUser, liked);
    setLikedMap((prev) => ({ ...prev, [activeReel.id]: next }));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left: 9:16 Cinema Frame */}
      <div className="lg:col-span-6 flex justify-center">
        <div className="relative w-full max-w-[400px] h-[72vh] max-h-[680px] rounded-3xl overflow-hidden bg-black border border-[#E4DFD5] dark:border-[#262C30] shadow-lg">
          {isVideoFile ? (
            <video
              key={activeReel.id}
              src={activeReel.mediaUrl}
              autoPlay
              loop
              muted={muted}
              playsInline
              preload="metadata"
              controls
              className="w-full h-full object-cover"
            />
          ) : (
            <img
              src={activeReel.mediaUrl}
              alt={activeReel.caption || 'Reel'}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          )}

          {/* Top Controls */}
          <div className="absolute top-3 inset-x-3 flex items-center justify-between">
            <span className="px-3 py-1 rounded-xl bg-black/50 backdrop-blur-md text-white text-xs font-semibold">
              Cinema Strip · {activeIndex + 1}/{reels.length}
            </span>
            <div className="flex items-center gap-2">
              {isVideoFile && (
                <button
                  type="button"
                  onClick={() => setMuted((m) => !m)}
                  className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center cursor-pointer"
                >
                  {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
              )}
              {allowVideoReels && (
                <button
                  type="button"
                  onClick={onOpenCreateReel}
                  className="h-10 px-3 rounded-full bg-[#0D6E6E] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New</span>
                </button>
              )}
            </div>
          </div>

          {/* Mobile/Compact Bottom Overlay */}
          <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/85 via-black/40 to-transparent text-white lg:hidden">
            <div className="flex items-center gap-2.5 mb-2">
              <Avatar src={activeReel.authorPhoto} name={activeReel.authorName} size="sm" />
              <span className="font-semibold text-sm">{activeReel.authorName}</span>
            </div>
            <p className="text-xs text-zinc-200 line-clamp-2">{activeReel.caption}</p>
          </div>
        </div>
      </div>

      {/* Right: Theater Info, Interactions & Reel Queue */}
      <div className="lg:col-span-6 space-y-4">
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => onSelectUser(activeReel.authorId)}
              className="flex items-center gap-3 text-left cursor-pointer"
            >
              <Avatar src={activeReel.authorPhoto} name={activeReel.authorName} size="md" />
              <div>
                <p className="font-semibold text-sm flex items-center gap-1.5">
                  <span>{activeReel.authorName}</span>
                  {verifiedUserIds?.has(activeReel.authorId) && <VerifiedBadge className="w-4 h-4" />}
                </p>
                <p className="text-xs text-zinc-500">
                  @{activeReel.authorUsername} · {formatRelativeTime(activeReel.createdAt)}
                </p>
              </div>
            </button>
            {activeReel.authorId !== currentUser.uid && (
              <button
                type="button"
                onClick={() => toggleFollowUser(currentUser, activeReel.authorId, isFollowing)}
                className={`h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer ${
                  isFollowing
                    ? 'border border-[#E4DFD5] dark:border-[#262C30]'
                    : 'bg-[#0D6E6E] text-white'
                }`}
              >
                {isFollowing ? t(lang, 'following') : t(lang, 'follow')}
              </button>
            )}
          </div>

          <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">
            {activeReel.caption || 'Short video moment on BANDHU MELA'}
          </p>

          <div className="grid grid-cols-4 gap-2 pt-2">
            <button
              type="button"
              onClick={handleLike}
              className={`h-11 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer ${
                liked ? 'text-rose-600 border-rose-300 bg-rose-50 dark:bg-rose-950/30' : ''
              }`}
            >
              <Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''}`} />
              <span className="tabular-nums">{activeReel.likesCount}</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenComments(activeReel)}
              className="h-11 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer"
            >
              <MessageCircle className="w-4 h-4" />
              <span className="tabular-nums">{activeReel.commentsCount}</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(`${window.location.origin}/?post=${activeReel.id}`);
                await incrementPostShare(activeReel.id);
                onToast('Reel link copied');
              }}
              className="h-11 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
              <span className="tabular-nums">{activeReel.sharesCount}</span>
            </button>
            <button
              type="button"
              onClick={() => toggleSavePost(currentUser.uid, activeReel.id, isSaved)}
              className={`h-11 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer ${
                isSaved ? 'text-[#0D6E6E] border-[#0D6E6E]' : ''
              }`}
            >
              <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`} />
              <span>{isSaved ? t(lang, 'saved') : t(lang, 'save')}</span>
            </button>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[#E4DFD5] dark:border-[#262C30]">
            <button
              type="button"
              disabled={activeIndex === 0}
              onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
              className="h-10 px-4 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
            >
              <ChevronUp className="w-4 h-4" />
              <span>Previous</span>
            </button>
            <button
              type="button"
              disabled={activeIndex >= reels.length - 1}
              onClick={() => setActiveIndex((i) => Math.min(reels.length - 1, i + 1))}
              className="h-10 px-4 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
            >
              <span>Next Reel</span>
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Up Next Queue */}
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-3">
          <h3 className="font-display text-sm font-bold">Up Next</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {reels.map((reel, idx) => (
              <button
                key={reel.id}
                type="button"
                onClick={() => setActiveIndex(idx)}
                className={`w-full p-2.5 rounded-2xl flex items-center gap-3 text-left transition-colors cursor-pointer ${
                  idx === activeIndex
                    ? 'bg-[#0D6E6E]/10 dark:bg-teal-500/15'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                }`}
              >
                <Avatar src={reel.authorPhoto} name={reel.authorName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate">{reel.authorName}</p>
                  <p className="text-xs text-zinc-500 truncate">{reel.caption || 'Video Reel'}</p>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-zinc-500">
                  {reel.likesCount} likes
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
