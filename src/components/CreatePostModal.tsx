import React, { useState } from 'react';
import { Film, Image as ImageIcon, Loader2, Type, Upload, X } from 'lucide-react';
import { uploadMediaFile } from '../lib/mediaUpload';
import { createPost } from '../lib/socialApi';
import { AspectRatio, MediaType, UserProfile } from '../types/social';

interface CreatePostModalProps {
  currentUser: UserProfile;
  defaultType?: MediaType;
  onClose: () => void;
  onCreated: () => void;
}

const CURATED_GALLERY = [
  {
    label: 'Evening Chai',
    url: '/src/assets/images/feed_evening_chai_1794810240274.jpg',
    aspect: '4:3' as AspectRatio,
  },
  {
    label: 'Himalayan Ridge',
    url: '/src/assets/images/feed_himalayan_ridge_1794810239945.jpg',
    aspect: '4:3' as AspectRatio,
  },
  {
    label: 'Rooftop Friends',
    url: '/src/assets/images/bandhu_hero_community_1794810238569.jpg',
    aspect: '16:9' as AspectRatio,
  },
];

export const CreatePostModal: React.FC<CreatePostModalProps> = ({
  currentUser,
  defaultType = 'image',
  onClose,
  onCreated,
}) => {
  const [mediaType, setMediaType] = useState<MediaType>(defaultType);
  const [caption, setCaption] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(defaultType === 'reel' ? '9:16' : '4:3');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploading(true);
    setUploadProgress(2);
    setUploadStage('Starting upload...');
    try {
      const isVideo = file.type.startsWith('video/');
      const nextType = isVideo && mediaType !== 'reel' ? 'video' : !isVideo && mediaType === 'text' ? 'image' : mediaType;
      if (nextType !== mediaType) setMediaType(nextType);
      const folder = nextType === 'reel' ? 'reels' : 'posts';
      const uploadedUrl = await uploadMediaFile(file, folder, currentUser.uid, {
        onProgress: (pct, stage) => {
          setUploadProgress(pct);
          setUploadStage(stage);
        },
      });
      setMediaUrl(uploadedUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload media');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!caption.trim() && !mediaUrl.trim()) {
      setError('Add a caption or attach a photo or video.');
      return;
    }
    if ((mediaType === 'image' || mediaType === 'video' || mediaType === 'reel') && !mediaUrl.trim()) {
      setError('Please upload a file, choose a gallery image, or paste a media URL.');
      return;
    }

    setSubmitting(true);
    try {
      await createPost({
        author: currentUser,
        caption: caption.trim(),
        mediaUrl: mediaType === 'text' ? '' : mediaUrl.trim(),
        mediaType,
        aspectRatio,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish post.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Share on BANDHU MELA</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
          <div className="grid grid-cols-4 gap-1 p-1 bg-[#F7F5F0] dark:bg-[#0E1113] rounded-xl">
            {(
              [
                { id: 'image', label: 'Photo', icon: ImageIcon },
                { id: 'reel', label: 'Reel', icon: Film },
                { id: 'video', label: 'Video', icon: Film },
                { id: 'text', label: 'Thought', icon: Type },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = mediaType === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setMediaType(item.id);
                    if (item.id === 'reel') setAspectRatio('9:16');
                    if (item.id === 'image') setAspectRatio('4:3');
                  }}
                  className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    active
                      ? 'bg-white dark:bg-[#171B1E] text-zinc-950 dark:text-white shadow-sm'
                      : 'text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div>
            <textarea
              rows={3}
              maxLength={2200}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={
                mediaType === 'reel'
                  ? 'Describe your short reel with #hashtags...'
                  : 'Write a story, update, or #hashtag...'
              }
              className="w-full p-3.5 rounded-2xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm focus:outline-none focus:ring-2 focus:ring-[#0D6E6E]/30 resize-none"
            />
          </div>

          {mediaType !== 'text' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="flex-1 h-11 px-4 rounded-xl border border-dashed border-[#0D6E6E]/40 hover:border-[#0D6E6E] flex items-center justify-center gap-2 text-sm font-medium cursor-pointer transition-colors">
                  {uploading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[#0D6E6E]" />
                  ) : (
                    <Upload className="w-4 h-4 text-[#0D6E6E]" />
                  )}
                  <span>{uploading ? `Uploading ${uploadProgress}%` : 'Upload Photo / Video'}</span>
                  <input
                    type="file"
                    disabled={uploading}
                    accept={mediaType === 'image' ? 'image/*' : 'video/*,image/*'}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>

                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                  className="h-11 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs font-medium"
                >
                  <option value="1:1">1:1 Square</option>
                  <option value="4:3">4:3 Photo</option>
                  <option value="16:9">16:9 Wide</option>
                  <option value="9:16">9:16 Reel</option>
                </select>
              </div>

              {uploading && (
                <div className="space-y-1.5 rounded-xl bg-[#F7F5F0] dark:bg-[#0E1113] p-3 border border-[#E4DFD5] dark:border-[#262C30]">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="text-zinc-600 dark:text-zinc-300 truncate">{uploadStage || 'Uploading...'}</span>
                    <span className="text-[#0D6E6E] dark:text-teal-400 font-bold">{uploadProgress}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full bg-[#0D6E6E] transition-all duration-200"
                      style={{ width: `${Math.max(4, uploadProgress)}%` }}
                    />
                  </div>
                </div>
              )}

              <input
                type="text"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder="Or paste an image / MP4 video URL"
                className="w-full h-10 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-xs focus:outline-none focus:ring-2 focus:ring-[#0D6E6E]/30"
              />

              {mediaType === 'image' && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  <span className="text-xs text-zinc-500 shrink-0">Quick picks:</span>
                  {CURATED_GALLERY.map((item) => (
                    <button
                      key={item.url}
                      type="button"
                      onClick={() => {
                        setMediaUrl(item.url);
                        setAspectRatio(item.aspect);
                      }}
                      className="px-2.5 py-1.5 rounded-lg border border-[#E4DFD5] dark:border-[#262C30] text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0 cursor-pointer"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}

              {mediaUrl && (
                <div className="rounded-2xl overflow-hidden border border-[#E4DFD5] dark:border-[#262C30] bg-black max-h-60 flex items-center justify-center">
                  {mediaType === 'video' || mediaType === 'reel' ? (
                    mediaUrl.match(/\.(mp4|webm|mov)(\?|$)/i) || mediaUrl.startsWith('/uploads/') ? (
                      <video src={mediaUrl} controls className="max-h-60 w-full object-contain" />
                    ) : (
                      <img
                        src={mediaUrl}
                        alt="Reel preview"
                        referrerPolicy="no-referrer"
                        className="max-h-60 w-full object-cover"
                      />
                    )
                  ) : (
                    <img
                      src={mediaUrl}
                      alt="Upload preview"
                      referrerPolicy="no-referrer"
                      className="max-h-60 w-full object-cover"
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded-xl px-3.5 py-2.5">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-11 px-4 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || uploading}
              className="h-11 px-6 rounded-xl bg-[#0D6E6E] text-white text-sm font-semibold hover:bg-[#095454] transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{mediaType === 'reel' ? 'Publish Reel' : 'Publish Post'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
