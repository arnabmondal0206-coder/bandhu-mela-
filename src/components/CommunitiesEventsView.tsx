import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Check,
  MapPin,
  Plus,
  Send,
  Users,
  X,
} from 'lucide-react';
import { t } from '../lib/i18n';
import {
  createCommunity,
  createCommunityPost,
  createSocialEvent,
  formatRelativeTime,
  rsvpEvent,
  subscribeCommunities,
  subscribeCommunityMembers,
  subscribeCommunityPosts,
  subscribeEventRsvps,
  subscribeEvents,
  toggleJoinCommunity,
} from '../lib/socialApi';
import {
  Community,
  CommunityMember,
  CommunityPost,
  EventRsvp,
  LanguageCode,
  SocialEvent,
  UserProfile,
} from '../types/social';
import { Avatar } from './Avatar';

interface CommunitiesEventsViewProps {
  currentUser: UserProfile;
  lang: LanguageCode;
  onToast: (msg: string) => void;
}

export const CommunitiesEventsView: React.FC<CommunitiesEventsViewProps> = ({
  currentUser,
  lang,
  onToast,
}) => {
  const [subTab, setSubTab] = useState<'communities' | 'events'>('communities');
  const [communities, setCommunities] = useState<Community[]>([]);
  const [selectedCommunity, setSelectedCommunity] = useState<Community | null>(null);
  const [commMembers, setCommMembers] = useState<CommunityMember[]>([]);
  const [commPosts, setCommPosts] = useState<CommunityPost[]>([]);
  const [postText, setPostText] = useState('');

  const [events, setEvents] = useState<SocialEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<SocialEvent | null>(null);
  const [eventRsvps, setEventRsvps] = useState<EventRsvp[]>([]);

  const [showCreateComm, setShowCreateComm] = useState(false);
  const [commName, setCommName] = useState('');
  const [commDesc, setCommDesc] = useState('');
  const [commCat, setCommCat] = useState('Culture & Adda');

  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [evtTitle, setEvtTitle] = useState('');
  const [evtDesc, setEvtDesc] = useState('');
  const [evtLoc, setEvtLoc] = useState('');
  const [evtDate, setEvtDate] = useState('');

  useEffect(() => {
    const u1 = subscribeCommunities(setCommunities);
    const u2 = subscribeEvents(setEvents);
    return () => {
      u1();
      u2();
    };
  }, []);

  useEffect(() => {
    if (!selectedCommunity) return;
    const updated = communities.find((c) => c.id === selectedCommunity.id);
    if (updated) setSelectedCommunity(updated);
    const u1 = subscribeCommunityMembers(selectedCommunity.id, setCommMembers);
    const u2 = subscribeCommunityPosts(selectedCommunity.id, setCommPosts);
    return () => {
      u1();
      u2();
    };
  }, [selectedCommunity?.id, communities]);

  useEffect(() => {
    if (!selectedEvent) return;
    const updated = events.find((ev) => ev.id === selectedEvent.id);
    if (updated) setSelectedEvent(updated);
    const u = subscribeEventRsvps(selectedEvent.id, setEventRsvps);
    return () => u();
  }, [selectedEvent?.id, events]);

  const isCommMember = commMembers.some((m) => m.userId === currentUser.uid);
  const myEventRsvp = eventRsvps.find((r) => r.userId === currentUser.uid);

  const handleCreateCommunity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commName.trim()) return;
    try {
      await createCommunity({
        creator: currentUser,
        name: commName,
        description: commDesc,
        category: commCat,
        coverUrl: '',
      });
      setCommName('');
      setCommDesc('');
      setShowCreateComm(false);
      onToast('Community created');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to create community');
    }
  };

  const handleCreateCommunityPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCommunity || !postText.trim()) return;
    try {
      await createCommunityPost({
        communityId: selectedCommunity.id,
        author: currentUser,
        text: postText,
      });
      setPostText('');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to publish in community');
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!evtTitle.trim() || !evtLoc.trim() || !evtDate.trim()) return;
    try {
      await createSocialEvent({
        host: currentUser,
        title: evtTitle,
        description: evtDesc,
        location: evtLoc,
        eventDate: evtDate,
        coverUrl: '',
      });
      setEvtTitle('');
      setEvtDesc('');
      setEvtLoc('');
      setEvtDate('');
      setShowCreateEvent(false);
      onToast('Event published');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to create event');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-[#F7F5F0] dark:bg-[#0E1113] rounded-xl">
          <button
            type="button"
            onClick={() => setSubTab('communities')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
              subTab === 'communities'
                ? 'bg-white dark:bg-[#171B1E] text-zinc-950 dark:text-white shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Users className="w-3.5 h-3.5 text-[#0D6E6E] dark:text-teal-400" />
            <span>
              {t(lang, 'communitiesTab')} ({communities.length})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('events')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
              subTab === 'events'
                ? 'bg-white dark:bg-[#171B1E] text-zinc-950 dark:text-white shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 text-amber-500" />
            <span>
              {t(lang, 'eventsTab')} ({events.length})
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => (subTab === 'communities' ? setShowCreateComm(true) : setShowCreateEvent(true))}
          className="h-10 px-4 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-[#095454] cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{subTab === 'communities' ? 'Create Community' : 'Host Event'}</span>
        </button>
      </div>

      {subTab === 'communities' ? (
        selectedCommunity ? (
          <div className="space-y-5">
            <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden">
              <div className="h-36 bg-zinc-900 relative">
                <img
                  src={selectedCommunity.coverUrl}
                  alt={selectedCommunity.name}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover opacity-80"
                />
                <button
                  type="button"
                  onClick={() => setSelectedCommunity(null)}
                  className="absolute top-3 left-3 h-9 px-3 rounded-xl bg-black/60 text-white text-xs font-semibold cursor-pointer"
                >
                  All Communities
                </button>
              </div>
              <div className="p-6 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-[#0D6E6E] dark:text-teal-400">
                    {selectedCommunity.category} · {selectedCommunity.membersCount} members
                  </p>
                  <h2 className="font-display text-2xl font-bold mt-1">{selectedCommunity.name}</h2>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1 max-w-2xl">
                    {selectedCommunity.description || 'Community courtyard on BANDHU MELA.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const joined = await toggleJoinCommunity(selectedCommunity.id, currentUser, isCommMember);
                    onToast(joined ? `Joined ${selectedCommunity.name}` : `Left ${selectedCommunity.name}`);
                  }}
                  className={`h-10 px-5 rounded-xl text-xs font-semibold cursor-pointer ${
                    isCommMember
                      ? 'border border-[#E4DFD5] dark:border-[#262C30]'
                      : 'bg-[#0D6E6E] text-white'
                  }`}
                >
                  {isCommMember ? 'Joined · Leave' : 'Join Community'}
                </button>
              </div>
            </div>

            {isCommMember && (
              <form
                onSubmit={handleCreateCommunityPost}
                className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-4 flex items-center gap-3"
              >
                <Avatar src={currentUser.photoURL} name={currentUser.displayName} size="sm" />
                <input
                  type="text"
                  maxLength={1500}
                  value={postText}
                  onChange={(e) => setPostText(e.target.value)}
                  placeholder={`Share a note with ${selectedCommunity.name}...`}
                  className="flex-1 h-11 px-4 rounded-xl bg-[#F7F5F0] dark:bg-[#0E1113] text-sm focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!postText.trim()}
                  className="h-11 px-4 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Post</span>
                </button>
              </form>
            )}

            <div className="space-y-3">
              {commPosts.length === 0 ? (
                <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-8 text-center text-sm text-zinc-500">
                  No discussions yet. Join the community to start the first thread!
                </div>
              ) : (
                commPosts.map((cp) => (
                  <div
                    key={cp.id}
                    className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 space-y-2"
                  >
                    <div className="flex items-center gap-2.5">
                      <Avatar src={cp.authorPhoto} name={cp.authorName} size="sm" />
                      <div>
                        <p className="text-sm font-semibold">{cp.authorName}</p>
                        <p className="text-xs text-zinc-500">{formatRelativeTime(cp.createdAt)}</p>
                      </div>
                    </div>
                    <p className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">{cp.text}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : communities.length === 0 ? (
          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-10 text-center space-y-3">
            <Users className="w-10 h-10 mx-auto text-[#0D6E6E]" />
            <h3 className="font-display text-lg font-bold">Start a Community Circle</h3>
            <p className="text-sm text-zinc-500 max-w-md mx-auto">
              Create hobby groups, neighborhood clubs, book circles, or alumni hubs on BANDHU MELA.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {communities.map((comm) => (
              <button
                key={comm.id}
                type="button"
                onClick={() => setSelectedCommunity(comm)}
                className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden text-left hover:border-[#0D6E6E] transition-colors cursor-pointer"
              >
                <div className="h-28 bg-zinc-900">
                  <img
                    src={comm.coverUrl}
                    alt={comm.name}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-5 space-y-1.5">
                  <p className="text-xs font-semibold text-[#0D6E6E] dark:text-teal-400">
                    {comm.category} · <span className="tabular-nums">{comm.membersCount}</span> members
                  </p>
                  <h3 className="font-display text-base font-bold">{comm.name}</h3>
                  <p className="text-xs text-zinc-500 line-clamp-2">{comm.description}</p>
                </div>
              </button>
            ))}
          </div>
        )
      ) : selectedEvent ? (
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden">
          <div className="h-44 bg-zinc-900 relative">
            <img
              src={selectedEvent.coverUrl}
              alt={selectedEvent.title}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover opacity-85"
            />
            <button
              type="button"
              onClick={() => setSelectedEvent(null)}
              className="absolute top-3 left-3 h-9 px-3 rounded-xl bg-black/60 text-white text-xs font-semibold cursor-pointer"
            >
              All Events
            </button>
          </div>
          <div className="p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                  {selectedEvent.eventDate} · {selectedEvent.attendeesCount} going/interested
                </p>
                <h2 className="font-display text-2xl font-bold mt-1">{selectedEvent.title}</h2>
                <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  <span>{selectedEvent.location} · Hosted by {selectedEvent.hostName}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => rsvpEvent(selectedEvent.id, currentUser, 'going', Boolean(myEventRsvp))}
                  className={`h-10 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                    myEventRsvp?.status === 'going'
                      ? 'bg-[#0D6E6E] text-white'
                      : 'border border-[#E4DFD5] dark:border-[#262C30]'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Going</span>
                </button>
                <button
                  type="button"
                  onClick={() => rsvpEvent(selectedEvent.id, currentUser, 'interested', Boolean(myEventRsvp))}
                  className={`h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer ${
                    myEventRsvp?.status === 'interested'
                      ? 'bg-amber-500 text-zinc-950'
                      : 'border border-[#E4DFD5] dark:border-[#262C30]'
                  }`}
                >
                  Interested
                </button>
                {myEventRsvp && (
                  <button
                    type="button"
                    onClick={() => rsvpEvent(selectedEvent.id, currentUser, 'cancel', true)}
                    className="h-10 px-3 rounded-xl text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                  >
                    Cancel RSVP
                  </button>
                )}
              </div>
            </div>

            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
              {selectedEvent.description}
            </p>

            <div className="pt-4 border-t border-[#E4DFD5] dark:border-[#262C30]">
              <h4 className="text-xs font-bold text-zinc-500 mb-2">
                Participants ({eventRsvps.length})
              </h4>
              <div className="flex flex-wrap gap-3 text-xs">
                {eventRsvps.map((r) => (
                  <span key={r.userId} className="font-medium text-zinc-800 dark:text-zinc-200">
                    {r.displayName} ({r.status})
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : events.length === 0 ? (
        <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-10 text-center space-y-3">
          <Calendar className="w-10 h-10 mx-auto text-amber-500" />
          <h3 className="font-display text-lg font-bold">No Upcoming Events Yet</h3>
          <p className="text-sm text-zinc-500 max-w-md mx-auto">
            Host cultural meetups, rooftop addas, study jams, or online webinars for the community.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {events.map((evt) => (
            <button
              key={evt.id}
              type="button"
              onClick={() => setSelectedEvent(evt)}
              className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden text-left hover:border-[#0D6E6E] transition-colors cursor-pointer"
            >
              <div className="h-28 bg-zinc-900">
                <img
                  src={evt.coverUrl}
                  alt={evt.title}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-5 space-y-1.5">
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                  {evt.eventDate} · <span className="tabular-nums">{evt.attendeesCount}</span> attending
                </p>
                <h3 className="font-display text-base font-bold">{evt.title}</h3>
                <p className="text-xs text-zinc-500 truncate">
                  {evt.location} · Hosted by {evt.hostName}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Create Community Modal */}
      {showCreateComm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between">
              <h3 className="font-display text-base font-bold">New Community</h3>
              <button type="button" onClick={() => setShowCreateComm(false)} className="w-9 h-9 rounded-full flex items-center justify-center cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateCommunity} className="p-6 space-y-3.5">
              <input
                type="text"
                required
                maxLength={80}
                value={commName}
                onChange={(e) => setCommName(e.target.value)}
                placeholder="Community Name"
                className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
              />
              <input
                type="text"
                required
                maxLength={50}
                value={commCat}
                onChange={(e) => setCommCat(e.target.value)}
                placeholder="Category (e.g. Photography, Music, Tech)"
                className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
              />
              <textarea
                rows={3}
                maxLength={500}
                value={commDesc}
                onChange={(e) => setCommDesc(e.target.value)}
                placeholder="What brings members together?"
                className="w-full p-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm resize-none"
              />
              <button type="submit" className="w-full h-11 rounded-xl bg-[#0D6E6E] text-white text-sm font-semibold cursor-pointer">
                Create Community
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Create Event Modal */}
      {showCreateEvent && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-[#E4DFD5] dark:border-[#262C30] flex items-center justify-between">
              <h3 className="font-display text-base font-bold">Host Event</h3>
              <button type="button" onClick={() => setShowCreateEvent(false)} className="w-9 h-9 rounded-full flex items-center justify-center cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateEvent} className="p-6 space-y-3.5">
              <input
                type="text"
                required
                maxLength={120}
                value={evtTitle}
                onChange={(e) => setEvtTitle(e.target.value)}
                placeholder="Event Title"
                className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
              />
              <input
                type="text"
                required
                maxLength={60}
                value={evtDate}
                onChange={(e) => setEvtDate(e.target.value)}
                placeholder="Date & Time (e.g. Sat, May 24 · 6:00 PM)"
                className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
              />
              <input
                type="text"
                required
                maxLength={140}
                value={evtLoc}
                onChange={(e) => setEvtLoc(e.target.value)}
                placeholder="Location or Livestream Link"
                className="w-full h-11 px-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
              />
              <textarea
                rows={3}
                maxLength={1000}
                value={evtDesc}
                onChange={(e) => setEvtDesc(e.target.value)}
                placeholder="Event details..."
                className="w-full p-3.5 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm resize-none"
              />
              <button type="submit" className="w-full h-11 rounded-xl bg-[#0D6E6E] text-white text-sm font-semibold cursor-pointer">
                Publish Event
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
