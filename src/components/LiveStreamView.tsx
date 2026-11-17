import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  Eye,
  Heart,
  Mic,
  MicOff,
  Radio,
  Send,
  StopCircle,
} from 'lucide-react';
import { t } from '../lib/i18n';
import {
  endLiveStream,
  joinLiveStream,
  leaveLiveStream,
  sendLiveCommentOrReaction,
  sendWebRTCSignal,
  startLiveStream,
  subscribeLiveComments,
  subscribeWebRTCSignals,
} from '../lib/socialApi';
import { LanguageCode, LiveComment, LiveStream, UserProfile } from '../types/social';
import { Avatar } from './Avatar';

interface LiveStreamViewProps {
  currentUser: UserProfile;
  liveStreams: LiveStream[];
  followerOrFriendUids: string[];
  allowLiveStreaming: boolean;
  initialStreamId?: string | null;
  lang: LanguageCode;
  onToast: (msg: string) => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export const LiveStreamView: React.FC<LiveStreamViewProps> = ({
  currentUser,
  liveStreams,
  followerOrFriendUids,
  allowLiveStreaming,
  initialStreamId,
  lang,
  onToast,
}) => {
  const [activeStream, setActiveStream] = useState<LiveStream | null>(null);
  const [streamTitle, setStreamTitle] = useState('');
  const [isHosting, setIsHosting] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [mediaError, setMediaError] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());

  useEffect(() => {
    if (initialStreamId) {
      const found = liveStreams.find((s) => s.id === initialStreamId);
      if (found) void handleWatchStream(found);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStreamId]);

  useEffect(() => {
    if (!activeStream) return;
    const latest = liveStreams.find((s) => s.id === activeStream.id);
    if (latest) {
      setActiveStream(latest);
    }
  }, [liveStreams, activeStream]);

  useEffect(() => {
    if (!activeStream) return;
    const unsubComments = subscribeLiveComments(activeStream.id, setComments);

    const unsubSignals = subscribeWebRTCSignals(activeStream.id, currentUser.uid, async (sig) => {
      try {
        if (isHosting && sig.type === 'offer') {
          const pc = new RTCPeerConnection(RTC_CONFIG);
          peerConnectionsRef.current.set(sig.fromUid, pc);
          localStreamRef.current?.getTracks().forEach((track) => {
            if (localStreamRef.current) pc.addTrack(track, localStreamRef.current);
          });
          pc.onicecandidate = (ev) => {
            if (ev.candidate) {
              void sendWebRTCSignal({
                streamId: activeStream.id,
                fromUid: currentUser.uid,
                toUid: sig.fromUid,
                type: 'ice',
                payload: JSON.stringify(ev.candidate),
              });
            }
          };
          await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(sig.payload)));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendWebRTCSignal({
            streamId: activeStream.id,
            fromUid: currentUser.uid,
            toUid: sig.fromUid,
            type: 'answer',
            payload: JSON.stringify(answer),
          });
        } else if (!isHosting && sig.type === 'answer') {
          const pc = peerConnectionsRef.current.get(sig.fromUid);
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(sig.payload)));
          }
        } else if (sig.type === 'ice') {
          const pc = peerConnectionsRef.current.get(sig.fromUid);
          if (pc) {
            await pc.addIceCandidate(new RTCIceCandidate(JSON.parse(sig.payload)));
          }
        }
      } catch (err) {
        console.warn('WebRTC live signal warning:', err);
      }
    });

    return () => {
      unsubComments();
      unsubSignals();
    };
  }, [activeStream?.id, currentUser.uid, isHosting]);

  const cleanupConnections = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
  };

  useEffect(() => {
    return () => cleanupConnections();
  }, []);

  const handleStartBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allowLiveStreaming) {
      onToast('Live streaming is currently paused by the app owner.');
      return;
    }
    setMediaError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = media;
      const created = await startLiveStream(
        currentUser,
        streamTitle || `${currentUser.displayName}'s Live Courtyard`,
        followerOrFriendUids
      );
      setIsHosting(true);
      setActiveStream(created);
      setTimeout(() => {
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = media;
        }
      }, 50);
      onToast('You are LIVE on BANDHU MELA!');
    } catch (err) {
      setMediaError(
        err instanceof Error
          ? `Camera/Microphone permission needed to stream live (${err.message}).`
          : 'Camera permission required to broadcast live.'
      );
    }
  };

  const handleWatchStream = async (stream: LiveStream) => {
    cleanupConnections();
    setIsHosting(stream.hostId === currentUser.uid);
    setActiveStream(stream);
    if (stream.hostId === currentUser.uid) return;

    await joinLiveStream(stream.id, currentUser);
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerConnectionsRef.current.set(stream.hostId, pc);
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.ontrack = (ev) => {
      if (remoteVideoRef.current && ev.streams[0]) {
        remoteVideoRef.current.srcObject = ev.streams[0];
      }
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        void sendWebRTCSignal({
          streamId: stream.id,
          fromUid: currentUser.uid,
          toUid: stream.hostId,
          type: 'ice',
          payload: JSON.stringify(ev.candidate),
        });
      }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendWebRTCSignal({
      streamId: stream.id,
      fromUid: currentUser.uid,
      toUid: stream.hostId,
      type: 'offer',
      payload: JSON.stringify(offer),
    });
  };

  const handleLeaveOrEnd = async () => {
    if (!activeStream) return;
    if (isHosting) {
      await endLiveStream(activeStream.id);
      onToast('Live broadcast ended');
    } else {
      await leaveLiveStream(activeStream.id, currentUser.uid);
    }
    cleanupConnections();
    setActiveStream(null);
    setIsHosting(false);
    setComments([]);
  };

  const toggleMic = () => {
    localStreamRef.current?.getAudioTracks().forEach((tr) => {
      tr.enabled = !micOn;
    });
    setMicOn((v) => !v);
  };

  const toggleCam = () => {
    localStreamRef.current?.getVideoTracks().forEach((tr) => {
      tr.enabled = !camOn;
    });
    setCamOn((v) => !v);
  };

  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStream || !commentText.trim()) return;
    await sendLiveCommentOrReaction(activeStream.id, currentUser, commentText, 'comment');
    setCommentText('');
  };

  return (
    <div className="space-y-6">
      {!activeStream ? (
        <>
          <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-6 sm:p-8 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                  Mela Stage · Real-Time WebRTC Broadcast
                </p>
                <h2 className="font-display text-2xl font-bold mt-1">{t(lang, 'goLive')}</h2>
                <p className="text-sm text-zinc-500 mt-1">
                  Stream live camera &amp; audio directly to friends and followers with live chat and reactions.
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Radio className="w-6 h-6" />
              </div>
            </div>

            {mediaError && (
              <p className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl px-4 py-3">
                {mediaError}
              </p>
            )}

            <form onSubmit={handleStartBroadcast} className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                maxLength={160}
                value={streamTitle}
                onChange={(e) => setStreamTitle(e.target.value)}
                placeholder="Give your live session a title (e.g. Evening Adda & Music)"
                className="flex-1 h-11 px-4 rounded-xl border border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0] dark:bg-[#0E1113] text-sm"
              />
              <button
                type="submit"
                disabled={!allowLiveStreaming}
                className="h-11 px-6 rounded-xl bg-[#0D6E6E] text-white text-sm font-semibold hover:bg-[#095454] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Radio className="w-4 h-4" />
                <span>{t(lang, 'goLive')}</span>
              </button>
            </form>
          </div>

          <div className="space-y-3">
            <h3 className="font-display text-lg font-bold">
              {t(lang, 'liveNow')} ({liveStreams.length})
            </h3>
            {liveStreams.length === 0 ? (
              <div className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-8 text-center text-sm text-zinc-500">
                No active live streams right now. Start one above!
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {liveStreams.map((stream) => (
                  <div
                    key={stream.id}
                    className="bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl p-5 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar src={stream.hostPhoto} name={stream.hostName} size="md" />
                      <div className="min-w-0">
                        <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                          LIVE · {stream.viewersCount} watching
                        </span>
                        <h4 className="font-semibold text-sm truncate">{stream.title}</h4>
                        <p className="text-xs text-zinc-500 truncate">{stream.hostName}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleWatchStream(stream)}
                      className="h-10 px-4 rounded-xl bg-[#0D6E6E] text-white text-xs font-semibold shrink-0 cursor-pointer"
                    >
                      {t(lang, 'joinLive')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-8 relative rounded-3xl overflow-hidden bg-zinc-950 border border-[#E4DFD5] dark:border-[#262C30] min-h-[420px] flex flex-col justify-between">
            {isHosting ? (
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-[480px] object-cover"
              />
            ) : (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                controls
                className="w-full h-[480px] object-cover"
              />
            )}

            <div className="absolute top-4 inset-x-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 bg-black/60 backdrop-blur-md text-white px-3 py-2 rounded-2xl">
                <Avatar src={activeStream.hostPhoto} name={activeStream.hostName} size="xs" />
                <div>
                  <p className="text-xs font-semibold">{activeStream.title}</p>
                  <p className="text-[11px] text-zinc-300">
                    {activeStream.hostName} · <Eye className="w-3 h-3 inline" /> {activeStream.viewersCount} ·{' '}
                    <Heart className="w-3 h-3 inline text-amber-400" /> {activeStream.reactionsCount}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleLeaveOrEnd}
                className="h-10 px-4 rounded-xl bg-red-600 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <StopCircle className="w-4 h-4" />
                <span>{isHosting ? t(lang, 'endLive') : 'Leave'}</span>
              </button>
            </div>

            <div className="absolute bottom-4 inset-x-4 flex items-center justify-between gap-2">
              {isHosting ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleMic}
                    className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center cursor-pointer"
                  >
                    {micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5 text-red-400" />}
                  </button>
                  <button
                    type="button"
                    onClick={toggleCam}
                    className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center cursor-pointer"
                  >
                    {camOn ? <Camera className="w-5 h-5" /> : <CameraOff className="w-5 h-5 text-red-400" />}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {(['❤️', '🔥', '👏', '🎉'] as const).map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => sendLiveCommentOrReaction(activeStream.id, currentUser, emoji, 'reaction')}
                      className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-md text-lg flex items-center justify-center hover:scale-110 transition-transform cursor-pointer"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-4 bg-white dark:bg-[#171B1E] border border-[#E4DFD5] dark:border-[#262C30] rounded-3xl flex flex-col h-[480px] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E4DFD5] dark:border-[#262C30]">
              <h3 className="font-display text-sm font-bold">Live Chat &amp; Reactions</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {comments.length === 0 ? (
                <p className="text-xs text-zinc-500 text-center py-8">No live comments yet.</p>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2.5 text-xs">
                    <Avatar src={c.authorPhoto} name={c.authorName} size="xs" />
                    <div className="min-w-0">
                      <span className="font-semibold text-zinc-900 dark:text-white mr-1.5">
                        {c.authorName}
                      </span>
                      <span className="text-zinc-700 dark:text-zinc-300">{c.text}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <form
              onSubmit={handleSendComment}
              className="p-3 border-t border-[#E4DFD5] dark:border-[#262C30] flex items-center gap-2"
            >
              <input
                type="text"
                value={commentText}
                maxLength={300}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Say something live..."
                className="flex-1 h-10 px-3.5 rounded-xl bg-[#F7F5F0] dark:bg-[#0E1113] text-xs focus:outline-none"
              />
              <button
                type="submit"
                disabled={!commentText.trim()}
                className="w-10 h-10 rounded-xl bg-[#0D6E6E] text-white flex items-center justify-center cursor-pointer disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
