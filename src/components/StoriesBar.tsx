import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, Loader2, Plus, Trash2, Upload, X } from 'lucide-react';
import { uploadMediaFile } from '../lib/mediaUpload';
import { createStory, deleteStory, formatRelativeTime, incrementStoryView } from '../lib/socialApi';
import { LanguageCode, LiveStream, StoryItem, UserProfile } from '../types/social';
import { t } from '../lib/i18n';
import { Avatar } from './Avatar';

interface StoriesBarProps {
  currentUser: UserProfile;
  stories: StoryItem[];
  liveStreams: LiveStream[];
  lang: LanguageCode;
  onOpenLive: (streamId?: string) => void;
}

const STORY_PRESETS = [
  '/src/assets/images/feed_evening_chai_1794810240274.jpg',
  '/src/assets/images/feed_himalayan_ridge_1794810239945.jpg',
  '/src/assets/images/cover_twilight_terrace_1794810238967.jpg',
];

export const StoriesBar: React.FC<StoriesBarProps> = ({
  currentUser,
  stories,
  liveStreams,
  lang,
  onOpenLive,
}) => {
  const [creating, setCreating] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const openStoryAt = (index: number) => {
    setActiveIndex(index);
    const story = stories[index];
    if (story && story.authorId !== currentUser.uid) {
      void incrementStoryView(story.id);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    setUploadProgress(2);
    setUploadStage('Starting story upload...');
    try {
      setMediaType(file.type.startsWith('video/') ? 'video' : 'image');
      const url = await uploadMediaFile(file, 'stories', currentUser.uid, {
        onProgress: (pct, stage) => {
          setUploadProgress(pct);
          setUploadStage(stage);
        },
      });
      setMediaUrl(url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Story upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mediaUrl.trim() || saving) return;
    setUploadError(null);
    setSaving(true);
    try {
      await createStory({
        author: currentUser,
        mediaUrl: mediaUrl.trim(),
        mediaType,
        caption,
      });
      setMediaUrl('');
      setCaption('');
      setCreating(false);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not publish story');
    } finally {
      setSaving(false);
    }
  };

  const activeStory = activeIndex !== null ? stories[activeIndex] : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          {t(lang, 'stories')}
        </h2>
        {liveStreams.length > 0 && (
          <button
            type="button"
            onClick={() => onOpenLive(liveStreams[0].id)}
            className="text-xs font-semibold text-pink-600 dark:text-pink-400 hover:underline cursor-pointer"
          >
            {liveStreams.length} {t(lang, 'liveNow')}
          </button>
        )}
      </div>

      {/* Modern Portrait Story & Live Strip */}
      <div className="flex items-stretch gap-3 overflow-x-auto no-scrollbar pb-1">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="w-28 h-44 shrink-0 rounded-3xl p-[1.5px] bandhu-gradient cursor-pointer group transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.98]"
        >
          <div className="w-full h-full rounded-[22px] bg-white dark:bg-[#14131D] flex flex-col items-center justify-center gap-2.5 p-3">
            <div className="w-11 h-11 rounded-2xl bandhu-gradient text-white flex items-center justify-center shadow-sm transition-transform duration-200 group-hover:scale-105">
              <Plus className="w-5 h-5" />
            </div>
            <span className="text-xs font-semibold text-center leading-tight text-zinc-900 dark:text-zinc-100">
              {t(lang, 'addStory')}
            </span>
          </div>
        </button>

        {liveStreams.map((stream) => (
          <button
            key={stream.id}
            type="button"
            onClick={() => onOpenLive(stream.id)}
            className="relative w-28 h-44 shrink-0 rounded-3xl p-[2px] bg-gradient-to-br from-pink-500 via-rose-500 to-orange-500 text-left cursor-pointer group transition-transform duration-200 hover:-translate-y-0.5"
          >
            <div className="relative w-full h-full rounded-[22px] overflow-hidden bg-zinc-950">
              <img
                src={stream.hostPhoto}
                alt={stream.hostName}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-200"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent p-2.5 flex flex-col justify-between">
                <span className="self-start px-2 py-0.5 rounded-md bg-gradient-to-r from-pink-600 to-orange-500 text-white text-[10px] font-bold tracking-wide">
                  LIVE
                </span>
                <p className="text-[11px] font-semibold text-white line-clamp-2">{stream.hostName}</p>
              </div>
            </div>
          </button>
        ))}

        {stories.map((story, idx) => (
          <button
            key={story.id}
            type="button"
            onClick={() => openStoryAt(idx)}
            className="relative w-28 h-44 shrink-0 rounded-3xl p-[1.5px] bg-gradient-to-br from-violet-500/75 via-fuchsia-500/75 to-orange-400/75 text-left cursor-pointer group transition-transform duration-200 hover:-translate-y-0.5"
          >
            <div className="relative w-full h-full rounded-[22px] overflow-hidden bg-zinc-950">
              {story.mediaType === 'video' ? (
                <video
                  src={story.mediaUrl}
                  muted
                  playsInline
                  preload="metadata"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                />
              ) : (
                <img
                  src={story.mediaUrl}
                  alt={story.authorName}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent p-2.5 flex flex-col justify-between">
                <Avatar src={story.authorPhoto} name={story.authorName} size="xs" className="ring-2 ring-pink-400" />
                <p className="text-[11px] font-semibold text-white truncate">{story.authorName}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Add 24h Story Modal */}
      {creating && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] rounded-3xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-[#E7E3F0] dark:border-[#252336] flex items-center justify-between">
              <h3 className="font-display text-base font-bold">{t(lang, 'addStory')} (24h)</h3>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handlePublish} className="p-6 space-y-4">
              <label className="h-12 px-4 rounded-xl border border-dashed border-violet-500/50 flex items-center justify-center gap-2 text-sm font-medium cursor-pointer hover:bg-violet-50/50 dark:hover:bg-violet-950/20">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin text-violet-600" /> : <Upload className="w-4 h-4 text-violet-600 dark:text-violet-400" />}
                <span>{uploading ? `Uploading ${uploadProgress}%...` : 'Upload Photo or Video (24h)'}</span>
                <input type="file" disabled={uploading} accept="image/*,video/*" onChange={handleFile} className="hidden" />
              </label>

              {uploading && (
                <div className="space-y-1.5 rounded-xl bg-[#F8F7FB] dark:bg-[#0B0B10] p-3 border border-[#E7E3F0] dark:border-[#252336]">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="text-zinc-600 dark:text-zinc-300 truncate">{uploadStage || 'Uploading...'}</span>
                    <span className="text-violet-600 dark:text-violet-400 font-bold">{uploadProgress}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full bandhu-gradient transition-all duration-200"
                      style={{ width: `${Math.max(4, uploadProgress)}%` }}
                    />
                  </div>
                </div>
              )}

              {uploadError && (
                <p className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded-xl px-3.5 py-2.5">
                  {uploadError}
                </p>
              )}

              <input
                type="text"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder="Or paste photo / video URL"
                className="w-full h-10 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs"
              />

              <div className="flex items-center gap-2 overflow-x-auto">
                <span className="text-xs text-zinc-500 shrink-0">Quick picks:</span>
                {STORY_PRESETS.map((url, idx) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => {
                      setMediaUrl(url);
                      setMediaType('image');
                    }}
                    className="px-2.5 py-1 rounded-lg border border-[#E4DFD5] dark:border-[#262C30] text-xs cursor-pointer shrink-0"
                  >
                    Scene {idx + 1}
                  </button>
                ))}
              </div>

              <input
                type="text"
                maxLength={300}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Add a short story caption..."
                className="w-full h-10 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
              />

              {mediaUrl && (
                <div className="rounded-2xl overflow-hidden bg-black max-h-52 flex items-center justify-center">
                  {mediaType === 'video' ? (
                    <video src={mediaUrl} controls className="max-h-52 w-full object-contain" />
                  ) : (
                    <img src={mediaUrl} alt="Story preview" className="max-h-52 w-full object-cover" />
                  )}
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="h-11 px-4 rounded-xl text-sm font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!mediaUrl.trim() || saving || uploading}
                  className="h-11 px-5 rounded-xl bg-[#0D6E6E] text-white text-sm font-semibold hover:bg-[#095454] cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Sharing...' : 'Share 24h Story'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Story Lightbox Viewer */}
      {activeStory && activeIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4">
          <div className="relative w-full max-w-md h-[82vh] rounded-3xl overflow-hidden bg-zinc-950 border border-zinc-800 flex flex-col">
            <div className="absolute top-0 inset-x-0 z-20 p-4 bg-gradient-to-b from-black/80 to-transparent flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Avatar src={activeStory.authorPhoto} name={activeStory.authorName} size="sm" />
                <div className="text-white">
                  <p className="text-sm font-semibold leading-tight">{activeStory.authorName}</p>
                  <p className="text-[11px] text-zinc-300">
                    {formatRelativeTime(activeStory.createdAt)} · <Eye className="w-3 h-3 inline" /> {activeStory.viewersCount}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {activeStory.authorId === currentUser.uid && (
                  <button
                    type="button"
                    onClick={async () => {
                      await deleteStory(activeStory.id);
                      setActiveIndex(null);
                    }}
                    className="w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-red-600 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveIndex(null)}
                  className="w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 flex items-center justify-center bg-black">
              {activeStory.mediaType === 'video' ? (
                <video src={activeStory.mediaUrl} controls autoPlay className="w-full h-full object-contain" />
              ) : (
                <img src={activeStory.mediaUrl} alt={activeStory.caption || 'Story'} className="w-full h-full object-cover" />
              )}
            </div>

            {activeStory.caption && (
              <div className="absolute bottom-0 inset-x-0 p-5 bg-gradient-to-t from-black/85 to-transparent text-white text-sm">
                {activeStory.caption}
              </div>
            )}

            {activeIndex > 0 && (
              <button
                type="button"
                onClick={() => openStoryAt(activeIndex - 1)}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            {activeIndex < stories.length - 1 && (
              <button
                type="button"
                onClick={() => openStoryAt(activeIndex + 1)}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center cursor-pointer"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
