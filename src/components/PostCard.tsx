import React, { useEffect, useState } from 'react';
import {
  Ban,
  Bookmark,
  Flag,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Share2,
  Trash2,
} from 'lucide-react';
import { t } from '../lib/i18n';
import {
  blockUser,
  checkUserLikedPost,
  deletePost,
  formatRelativeTime,
  incrementPostShare,
  toggleFollowUser,
  toggleLikePost,
  toggleSavePost,
} from '../lib/socialApi';
import { computeLevelSummary, DEFAULT_LEVEL_CONFIG } from '../lib/levelVipApi';
import { LanguageCode, LevelConfig, Post, SpeakingStats, UserPresence, UserProfile } from '../types/social';
import { Avatar } from './Avatar';
import { LevelBadge } from './LevelBadge';
import { VerifiedBadge } from './VerifiedBadge';

interface PostCardProps {
  post: Post;
  currentUser: UserProfile;
  authorPresence?: UserPresence;
  authorVerified?: boolean;
  authorStats?: SpeakingStats | null;
  levelConfig?: LevelConfig;
  isFollowingAuthor: boolean;
  isSaved: boolean;
  lang: LanguageCode;
  onOpenComments: (post: Post) => void;
  onSelectUser: (uid: string) => void;
  onReportPost: (post: Post) => void;
  onSelectHashtag: (tag: string) => void;
  onToast: (msg: string) => void;
}

export const PostCard: React.FC<PostCardProps> = ({
  post,
  currentUser,
  authorPresence,
  authorVerified = false,
  authorStats = null,
  levelConfig = DEFAULT_LEVEL_CONFIG,
  isFollowingAuthor,
  isSaved,
  lang,
  onOpenComments,
  onSelectUser,
  onReportPost,
  onSelectHashtag,
  onToast,
}) => {
  const levelSummary = computeLevelSummary(authorStats, levelConfig);
  const isVipFrame = levelSummary.isVip && levelConfig.enableVipFrames;
  const isVipName = levelSummary.isVip && levelConfig.enableVipNameColors;
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(post.likesCount);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busyLike, setBusyLike] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setLikesCount(post.likesCount);
  }, [post.likesCount]);

  useEffect(() => {
    let active = true;
    void checkUserLikedPost(post.id, currentUser.uid)
      .then((res) => {
        if (active) setLiked(res);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [post.id, currentUser.uid]);

  const handleLike = async () => {
    if (busyLike) return;
    setBusyLike(true);
    const prevLiked = liked;
    const prevCount = likesCount;
    setLiked(!prevLiked);
    setLikesCount(prevLiked ? Math.max(0, prevCount - 1) : prevCount + 1);
    try {
      await toggleLikePost(post, currentUser, prevLiked);
    } catch {
      setLiked(prevLiked);
      setLikesCount(prevCount);
    } finally {
      setBusyLike(false);
    }
  };

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}/?post=${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `BANDHU MELA · ${post.authorName}`, text: post.caption, url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
      }
      await incrementPostShare(post.id);
      onToast('Post link copied to share');
    } catch {
      // User cancelled share dialog
    }
  };

  const handleSave = async () => {
    const next = await toggleSavePost(currentUser.uid, post.id, isSaved);
    onToast(next ? 'Saved to your collection' : 'Removed from saved posts');
  };

  const isOwn = post.authorId === currentUser.uid;
  const isVideo = post.mediaType === 'video' || post.mediaType === 'reel';
  const showVideoTag = isVideo && Boolean(post.mediaUrl.match(/\.(mp4|webm|mov)(\?|$)/i) || post.mediaUrl.startsWith('/uploads/'));

  return (
    <article className="bm-enter bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] hover:border-violet-300/70 dark:hover:border-violet-700/60 rounded-3xl overflow-hidden transition-colors">
      <div className="px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => onSelectUser(post.authorId)}
            className="relative shrink-0 cursor-pointer"
          >
            <Avatar src={post.authorPhoto} name={post.authorName} size="md" isVip={isVipFrame} />
            {authorPresence?.isOnline && (
              <span
                title="Online"
                className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#14131D]"
              />
            )}
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => onSelectUser(post.authorId)}
                className={`font-semibold text-sm truncate hover:text-violet-600 dark:hover:text-violet-400 cursor-pointer ${
                  isVipName ? 'text-orange-500 dark:text-orange-400' : 'text-zinc-950 dark:text-white'
                }`}
              >
                {post.authorName}
              </button>
              {authorVerified && <VerifiedBadge className="w-4 h-4" />}
              <LevelBadge stats={authorStats} config={levelConfig} compact />
              <span className="text-zinc-400 text-xs">·</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{formatRelativeTime(post.createdAt)}</span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
              @{post.authorUsername}
              {post.mediaType === 'reel' && ' · Reel'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 relative">
          {!isOwn && (
            <button
              type="button"
              onClick={() => toggleFollowUser(currentUser, post.authorId, isFollowingAuthor)}
              className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                isFollowingAuthor
                  ? 'border border-[#E7E3F0] dark:border-[#252336] text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  : 'bg-violet-600/10 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300 hover:bg-violet-600/20'
              }`}
            >
              {isFollowingAuthor ? t(lang, 'following') : t(lang, 'follow')}
            </button>
          )}

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Post options"
            className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <MoreHorizontal className="w-5 h-5 text-zinc-500" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-11 z-20 w-52 bg-white dark:bg-[#1B1928] border border-[#E7E3F0] dark:border-[#2D2A42] rounded-2xl shadow-lg py-1.5 text-sm">
              <button
                type="button"
                onClick={async () => {
                  setMenuOpen(false);
                  const url = `${window.location.origin}/?post=${post.id}`;
                  await navigator.clipboard.writeText(url);
                  await incrementPostShare(post.id);
                  onToast('Shareable post link copied');
                }}
                className="w-full px-4 py-2.5 text-left flex items-center gap-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <Share2 className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                <span>Copy Share Link</span>
              </button>
              {isOwn ? (
                <button
                  type="button"
                  onClick={async () => {
                    setMenuOpen(false);
                    await deletePost(post.id, currentUser.uid);
                    onToast('Post deleted');
                  }}
                  className="w-full px-4 py-2.5 text-left flex items-center gap-2.5 text-red-600 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete Post</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onReportPost(post);
                    }}
                    className="w-full px-4 py-2.5 text-left flex items-center gap-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    <Flag className="w-4 h-4 text-amber-600" />
                    <span>Report Post</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setMenuOpen(false);
                      await blockUser(currentUser.uid, post.authorId);
                      onToast(`Blocked @${post.authorUsername}`);
                    }}
                    className="w-full px-4 py-2.5 text-left flex items-center gap-2.5 text-red-600 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    <Ban className="w-4 h-4" />
                    <span>Block User</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {post.caption && (
        <div className="px-5 pb-3.5 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
          {post.caption.split(/(#[a-zA-Z0-9_\u0980-\u09FF]+)/g).map((part, idx) =>
            part.startsWith('#') ? (
              <button
                key={idx}
                type="button"
                onClick={() => onSelectHashtag(part.toLowerCase())}
                className="text-violet-600 dark:text-violet-400 font-semibold hover:underline cursor-pointer"
              >
                {part}
              </button>
            ) : (
              <React.Fragment key={idx}>{part}</React.Fragment>
            )
          )}
        </div>
      )}

      {post.mediaUrl && (
        <div className="bg-zinc-950 border-y border-[#E7E3F0] dark:border-[#252336] max-h-[520px] flex items-center justify-center overflow-hidden">
          {showVideoTag ? (
            <video src={post.mediaUrl} controls playsInline preload="metadata" className="w-full max-h-[520px] object-contain" />
          ) : imgError ? (
            <div className="w-full h-56 bg-[#F8F7FB] dark:bg-[#0B0B10] flex items-center justify-center text-xs text-zinc-500">
              Media unavailable
            </div>
          ) : (
            <img
              src={post.mediaUrl}
              alt={post.caption || `Post by ${post.authorName}`}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onDoubleClick={handleLike}
              onError={() => setImgError(true)}
              className="w-full max-h-[520px] object-cover select-none"
            />
          )}
        </div>
      )}

      <div className="px-4 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleLike}
            className={`min-h-[44px] px-3 rounded-xl flex items-center gap-2 text-sm font-medium transition-transform active:scale-95 cursor-pointer ${
              liked
                ? 'text-pink-600 dark:text-pink-400 bg-pink-50 dark:bg-pink-950/30'
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Heart className={`w-5 h-5 ${liked ? 'fill-current' : ''}`} />
            <span className="tabular-nums text-xs font-semibold">{likesCount}</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenComments(post)}
            className="min-h-[44px] px-3 rounded-xl flex items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <MessageCircle className="w-5 h-5" />
            <span className="tabular-nums text-xs font-semibold">{post.commentsCount}</span>
          </button>

          <button
            type="button"
            onClick={handleShare}
            className="min-h-[44px] px-3 rounded-xl flex items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <Share2 className="w-5 h-5" />
            <span className="tabular-nums text-xs font-semibold">{post.sharesCount}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleSave}
          aria-label={isSaved ? t(lang, 'saved') : t(lang, 'save')}
          className={`min-h-[44px] px-3 rounded-xl flex items-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            isSaved
              ? 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40'
              : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
        >
          <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`} />
          <span>{isSaved ? t(lang, 'saved') : t(lang, 'save')}</span>
        </button>
      </div>
    </article>
  );
};
