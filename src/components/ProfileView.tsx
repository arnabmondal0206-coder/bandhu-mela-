import React, { useEffect, useState } from 'react';
import {
  Ban,
  Bookmark,
  Camera,
  Crown,
  Download,
  Film,
  Flag,
  Grid3X3,
  KeyRound,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  Phone,
  Shield,
  Trash2,
  UserPlus,
  Video,
  X,
} from 'lucide-react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { t } from '../lib/i18n';
import { uploadMediaFile } from '../lib/mediaUpload';
import {
  blockUser,
  deleteMyAccountAndData,
  exportMyUserData,
  getPrivateUserInfo,
  sendFriendRequest,
  toggleFollowUser,
  updateUserProfile,
} from '../lib/socialApi';
import {
  computeLevelSummary,
  DEFAULT_LEVEL_CONFIG,
  subscribeSpeakingHistory,
} from '../lib/levelVipApi';
import {
  LanguageCode,
  LevelConfig,
  Post,
  SpeakingMonthHistory,
  SpeakingStats,
  UserPresence,
  UserPrivateInfo,
  UserProfile,
} from '../types/social';
import { Avatar } from './Avatar';
import { LevelBadge, LevelProgressCard } from './LevelBadge';
import { PostCard } from './PostCard';
import { VerifiedBadge } from './VerifiedBadge';

interface ProfileViewProps {
  profile: UserProfile;
  currentUser: UserProfile;
  presence?: UserPresence;
  posts: Post[];
  savedPosts: Post[];
  followingIds: Set<string>;
  savedIds: Set<string>;
  levelConfig?: LevelConfig;
  speakingStats?: SpeakingStats | null;
  lang: LanguageCode;
  isOriginalOwner?: boolean;
  verifiedOwnerUid?: string | null;
  ownerBackendVerified?: boolean;
  onOpenOwnerDashboard?: () => void;
  onProfileUpdated: (next: UserProfile) => void;
  onOpenComments: (post: Post) => void;
  onOpenChatWith: (uid: string) => void;
  onStartCall: (peer: UserProfile, callType: 'audio' | 'video') => void;
  onSelectUser: (uid: string) => void;
  onSelectHashtag: (tag: string) => void;
  onReportUserOrPost: (target: { type: 'post' | 'user'; id: string; ownerId: string; label: string }) => void;
  onOpenPrivacy: () => void;
  onToast: (msg: string) => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  profile,
  currentUser,
  presence,
  posts,
  savedPosts,
  followingIds,
  savedIds,
  levelConfig = DEFAULT_LEVEL_CONFIG,
  speakingStats = null,
  lang,
  isOriginalOwner = false,
  verifiedOwnerUid = null,
  ownerBackendVerified = false,
  onOpenOwnerDashboard,
  onProfileUpdated,
  onOpenComments,
  onOpenChatWith,
  onStartCall,
  onSelectUser,
  onSelectHashtag,
  onReportUserOrPost,
  onOpenPrivacy,
  onToast,
}) => {
  const isOwn = profile.uid === currentUser.uid;
  const isVerifiedOriginalOwner = Boolean(
    isOwn &&
      isOriginalOwner &&
      onOpenOwnerDashboard &&
      (!verifiedOwnerUid || verifiedOwnerUid === currentUser.uid)
  );
  const [tab, setTab] = useState<'posts' | 'reels' | 'saved'>('posts');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePhrase, setDeletePhrase] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [privateInfo, setPrivateInfo] = useState<UserPrivateInfo | null>(null);
  const [speakingHistory, setSpeakingHistory] = useState<SpeakingMonthHistory[]>([]);

  const levelSummary = computeLevelSummary(speakingStats, levelConfig);
  const isVipFrame = levelSummary.isVip && levelConfig.enableVipFrames;
  const isVipName = levelSummary.isVip && levelConfig.enableVipNameColors;

  const [displayName, setDisplayName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio);
  const [location, setLocation] = useState(profile.location);
  const [workOrBioTag, setWorkOrBioTag] = useState(profile.workOrBioTag);
  const [photoURL, setPhotoURL] = useState(profile.photoURL);
  const [coverURL, setCoverURL] = useState(profile.coverURL);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingField, setUploadingField] = useState<'avatar' | 'cover' | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(profile.displayName);
    setUsername(profile.username);
    setBio(profile.bio);
    setLocation(profile.location);
    setWorkOrBioTag(profile.workOrBioTag);
    setPhotoURL(profile.photoURL);
    setCoverURL(profile.coverURL);
  }, [profile]);

  useEffect(() => {
    return subscribeSpeakingHistory(profile.uid, setSpeakingHistory);
  }, [profile.uid]);

  useEffect(() => {
    if (!isOwn) return;
    void getPrivateUserInfo(currentUser.uid)
      .then((info) => {
        setPrivateInfo(info);
        if (info?.phoneNumber) setPhoneNumber(info.phoneNumber);
      })
      .catch(() => {});
  }, [isOwn, currentUser.uid]);

  const userPosts = posts.filter((p) => p.authorId === profile.uid);
  const userReels = userPosts.filter((p) => p.mediaType === 'reel');
  const activeList = tab === 'reels' ? userReels : tab === 'saved' && isOwn ? savedPosts : userPosts;
  const isFollowing = followingIds.has(profile.uid);

  const handleUpload = async (field: 'avatar' | 'cover', file?: File) => {
    if (!file) return;
    setProfileError(null);
    setUploadingField(field);
    setUploadProgress(2);
    setUploadStage(`Preparing ${field}...`);
    try {
      const url = await uploadMediaFile(file, field === 'avatar' ? 'avatars' : 'covers', currentUser.uid, {
        onProgress: (pct, stage) => {
          setUploadProgress(pct);
          setUploadStage(stage);
        },
      });
      if (field === 'avatar') setPhotoURL(url);
      else setCoverURL(url);
      onToast(`${field === 'avatar' ? 'Profile photo' : 'Cover photo'} uploaded. Tap Save Changes to apply.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Failed to upload ${field} photo`;
      setProfileError(msg);
      onToast(msg);
    } finally {
      setUploadingField(null);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateUserProfile(currentUser.uid, {
        displayName,
        username,
        bio,
        location,
        workOrBioTag,
        photoURL,
        coverURL,
        phoneNumber,
        email: privateInfo?.email || auth.currentUser?.email || '',
      });
      onProfileUpdated({
        ...profile,
        displayName: displayName.trim() || profile.displayName,
        username: username.trim() || profile.username,
        bio: bio.trim(),
        location: location.trim(),
        workOrBioTag: workOrBioTag.trim(),
        photoURL,
        coverURL,
      });
      setEditing(false);
      onToast('Profile updated');
    } finally {
      setSaving(false);
    }
  };

  const handleSendPasswordReset = async () => {
    const email = auth.currentUser?.email;
    if (!email) return;
    await sendPasswordResetEmail(auth, email);
    onToast(`Password recovery email sent to ${email}`);
  };

  const handleExportMyData = async () => {
    const data = await exportMyUserData(currentUser.uid);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bandhu-mela-my-data-${currentUser.username}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onToast('Personal data exported as JSON');
  };

  const handlePermanentDelete = async () => {
    if (!auth.currentUser || deletePhrase.trim().toUpperCase() !== 'DELETE') return;
    setDeletingAccount(true);
    try {
      await deleteMyAccountAndData(auth.currentUser);
      onToast('Account and data permanently deleted');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to delete account');
    } finally {
      setDeletingAccount(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Original Courtyard Pavilion Header */}
      <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden">
        <div className="relative h-44 sm:h-56 bg-zinc-900">
          <img
            src={profile.coverURL}
            alt={`${profile.displayName} cover`}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        </div>

        <div className="px-6 pb-6">
          <div className="flex flex-wrap items-end justify-between gap-4 -mt-12 relative z-10">
            <div className="flex items-end gap-4">
              <div className="relative">
                <Avatar
                  src={profile.photoURL}
                  name={profile.displayName}
                  size="xl"
                  isVip={isVipFrame}
                  className={isVipFrame ? '' : 'ring-4 ring-white dark:ring-[#171B1E] rounded-2xl'}
                />
                {profile.showOnlineStatus !== false && presence?.isOnline && (
                  <span className="absolute bottom-1 right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#171B1E]" />
                )}
              </div>
              <div className="pb-1">
                <h2 className="font-display text-2xl font-bold flex items-center gap-2 flex-wrap">
                  <span className={isVipName ? 'text-amber-500 dark:text-amber-400' : ''}>
                    {profile.displayName}
                  </span>
                  {profile.isVerified && <VerifiedBadge className="w-5 h-5" />}
                  <LevelBadge stats={speakingStats} config={levelConfig} />
                </h2>
                <p className="text-xs text-zinc-500">
                  @{profile.username}
                  {profile.workOrBioTag ? ` · ${profile.workOrBioTag}` : ''}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isOwn ? (
                <>
                  {isVerifiedOriginalOwner && (
                    <button
                      type="button"
                      onClick={onOpenOwnerDashboard}
                      data-testid="profile-super-admin-button"
                      className="h-10 px-4 rounded-xl bg-gradient-to-r from-violet-600 via-pink-500 to-orange-500 text-white text-xs font-bold shadow-sm shadow-violet-500/25 hover:opacity-95 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Crown className="w-3.5 h-3.5" />
                      <span>Super Admin Dashboard</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="h-10 px-4 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold hover:bg-[#095454] cursor-pointer"
                  >
                    {t(lang, 'editProfile')}
                  </button>
                  <button
                    type="button"
                    onClick={onOpenPrivacy}
                    className="h-10 px-4 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Shield className="w-3.5 h-3.5" />
                    <span>Privacy &amp; Help</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => toggleFollowUser(currentUser, profile.uid, isFollowing)}
                    className={`h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer ${
                      isFollowing
                        ? 'border border-[#E4DFD5] dark:border-[#262C30]'
                        : 'bg-[#0D6E6E] text-white'
                    }`}
                  >
                    {isFollowing ? t(lang, 'following') : t(lang, 'follow')}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await sendFriendRequest(currentUser, profile);
                      onToast(`Friend request sent to ${profile.displayName}`);
                    }}
                    className="h-10 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>{t(lang, 'addFriend')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenChatWith(profile.uid)}
                    className="h-10 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>{t(lang, 'message')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartCall(profile, 'audio')}
                    aria-label="Voice call"
                    className="w-10 h-10 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-center cursor-pointer"
                  >
                    <Phone className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartCall(profile, 'video')}
                    aria-label="Video call"
                    className="w-10 h-10 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-center cursor-pointer"
                  >
                    <Video className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onReportUserOrPost({
                        type: 'user',
                        id: profile.uid,
                        ownerId: profile.uid,
                        label: `@${profile.username}`,
                      })
                    }
                    aria-label="Report user"
                    className="w-10 h-10 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-center text-amber-600 cursor-pointer"
                  >
                    <Flag className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await blockUser(currentUser.uid, profile.uid);
                      onToast(`Blocked @${profile.username}`);
                    }}
                    aria-label="Block user"
                    className="w-10 h-10 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-center text-red-600 cursor-pointer"
                  >
                    <Ban className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {profile.bio && <p className="text-sm text-zinc-700 dark:text-zinc-300">{profile.bio}</p>}
            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
              {profile.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {profile.location}
                </span>
              )}
              {isOwn && privateInfo?.email && (
                <span>Private Email: {privateInfo.email}</span>
              )}
              {isOwn && privateInfo?.phoneNumber && (
                <span>· Private Mobile: {privateInfo.phoneNumber}</span>
              )}
            </div>
          </div>

          {/* Stats Strip */}
          <div className="mt-5 pt-4 border-t border-[#E4DFD5] dark:border-[#262C30] flex items-center gap-6 text-sm">
            <div>
              <span className="font-bold tabular-nums">{userPosts.length}</span>{' '}
              <span className="text-zinc-500 text-xs">{t(lang, 'posts')}</span>
            </div>
            <div>
              <span className="font-bold tabular-nums">{profile.followersCount}</span>{' '}
              <span className="text-zinc-500 text-xs">{t(lang, 'followers')}</span>
            </div>
            <div>
              <span className="font-bold tabular-nums">{profile.followingCount}</span>{' '}
              <span className="text-zinc-500 text-xs">{t(lang, 'following')}</span>
            </div>
          </div>

          {isOwn && (
            <div className="mt-4 pt-4 border-t border-[#E4DFD5] dark:border-[#262C30] flex flex-wrap items-center gap-2">
              {isVerifiedOriginalOwner && (
                <button
                  type="button"
                  onClick={onOpenOwnerDashboard}
                  className="h-9 px-3.5 rounded-xl bg-amber-500/15 border border-amber-400/50 text-amber-800 dark:text-amber-300 text-xs font-bold flex items-center gap-1.5 hover:bg-amber-500/25 cursor-pointer"
                >
                  <Crown className="w-3.5 h-3.5 text-amber-500" />
                  <span>Super Admin Owner Control</span>
                  <Lock className="w-3 h-3 opacity-80" />
                  <span className="text-[10px] font-mono opacity-80">
                    ({ownerBackendVerified ? 'UID Locked' : 'Owner'})
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={handleSendPasswordReset}
                className="h-9 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5 text-[#0D6E6E]" />
                <span>Reset Password</span>
              </button>
              <button
                type="button"
                onClick={handleExportMyData}
                className="h-9 px-3 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#0D6E6E]" />
                <span>Export My Data (JSON)</span>
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="h-9 px-3 rounded-xl border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t(lang, 'deleteAccount')}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Monthly Live Audio Level, Progress Bar & VIP Status */}
      <LevelProgressCard
        stats={speakingStats}
        history={speakingHistory}
        config={levelConfig}
        isOwnProfile={isOwn}
      />

      {/* Posts / Reels / Saved Filter */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTab('posts')}
          className={`h-10 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
            tab === 'posts' ? 'bg-[#0D6E6E] text-white' : 'bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30]'
          }`}
        >
          <Grid3X3 className="w-3.5 h-3.5" />
          <span>Posts ({userPosts.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('reels')}
          className={`h-10 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
            tab === 'reels' ? 'bg-[#0D6E6E] text-white' : 'bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30]'
          }`}
        >
          <Film className="w-3.5 h-3.5" />
          <span>Reels ({userReels.length})</span>
        </button>
        {isOwn && (
          <button
            type="button"
            onClick={() => setTab('saved')}
            className={`h-10 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
              tab === 'saved' ? 'bg-[#0D6E6E] text-white' : 'bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30]'
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span>Saved ({savedPosts.length})</span>
          </button>
        )}
      </div>

      <div className="space-y-4">
        {activeList.length === 0 ? (
          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-10 text-center text-sm text-zinc-500">
            Nothing to show in this tab yet.
          </div>
        ) : (
          activeList.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUser={currentUser}
              authorPresence={presence}
              authorVerified={profile.isVerified}
              authorStats={speakingStats}
              levelConfig={levelConfig}
              isFollowingAuthor={followingIds.has(post.authorId)}
              isSaved={savedIds.has(post.id)}
              lang={lang}
              onOpenComments={onOpenComments}
              onSelectUser={onSelectUser}
              onReportPost={(p) =>
                onReportUserOrPost({
                  type: 'post',
                  id: p.id,
                  ownerId: p.authorId,
                  label: `post by @${p.authorUsername}`,
                })
              }
              onSelectHashtag={onSelectHashtag}
              onToast={onToast}
            />
          ))
        )}
      </div>

      {/* Edit Profile Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between">
              <h3 className="font-display text-base font-bold">{t(lang, 'editProfile')}</h3>
              <button type="button" onClick={() => setEditing(false)} className="w-9 h-9 rounded-full flex items-center justify-center cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveProfile} className="p-6 space-y-3.5 max-h-[82vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <label className="h-11 px-3 rounded-xl border border-dashed border-[#0D6E6E]/50 flex items-center justify-center gap-2 text-xs font-semibold cursor-pointer">
                  {uploadingField === 'avatar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4 text-[#0D6E6E]" />}
                  <span>{uploadingField === 'avatar' ? `Avatar ${uploadProgress}%` : 'Change Avatar'}</span>
                  <input
                    type="file"
                    disabled={Boolean(uploadingField)}
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      void handleUpload('avatar', f);
                    }}
                    className="hidden"
                  />
                </label>
                <label className="h-11 px-3 rounded-xl border border-dashed border-[#0D6E6E]/50 flex items-center justify-center gap-2 text-xs font-semibold cursor-pointer">
                  {uploadingField === 'cover' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4 text-[#0D6E6E]" />}
                  <span>{uploadingField === 'cover' ? `Cover ${uploadProgress}%` : 'Change Cover'}</span>
                  <input
                    type="file"
                    disabled={Boolean(uploadingField)}
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      void handleUpload('cover', f);
                    }}
                    className="hidden"
                  />
                </label>
              </div>
              {uploadingField && (
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
              {profileError && (
                <p className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded-xl px-3.5 py-2.5">
                  {profileError}
                </p>
              )}
              <input type="text" required maxLength={60} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display Name" className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm" />
              <input type="text" required maxLength={30} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm" />
              <input type="text" maxLength={80} value={workOrBioTag} onChange={(e) => setWorkOrBioTag(e.target.value)} placeholder="Headline / Craft (e.g. Photographer)" className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm" />
              <input type="text" maxLength={80} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City / Location" className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm" />
              <input type="tel" maxLength={24} value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="Private Mobile Number" className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm" />
              <textarea rows={3} maxLength={300} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Bio" className="w-full p-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm resize-none" />
              <button type="submit" disabled={saving || Boolean(uploadingField)} className="w-full h-11 rounded-xl bg-[#0D6E6E] text-white text-sm font-semibold cursor-pointer disabled:opacity-60">
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Permanent Account Deletion Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 space-y-4">
            <h3 className="font-display text-lg font-bold text-red-600">Permanently Delete Account?</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              This removes your profile, private contact record, posts, stories, saved items, and Firebase Auth login permanently. Type <span className="font-mono font-bold">DELETE</span> to confirm.
            </p>
            <input
              type="text"
              value={deletePhrase}
              onChange={(e) => setDeletePhrase(e.target.value)}
              placeholder="Type DELETE"
              className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} className="h-10 px-4 rounded-xl text-sm font-medium cursor-pointer">
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingAccount || deletePhrase.trim().toUpperCase() !== 'DELETE'}
                onClick={handlePermanentDelete}
                className="h-10 px-4 rounded-xl bg-red-600 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
              >
                {deletingAccount ? 'Deleting...' : 'Confirm Permanent Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
