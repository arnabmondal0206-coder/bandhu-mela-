import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Mic, MicOff, Phone, PhoneOff, Video } from 'lucide-react';
import {
  addCallCandidate,
  subscribeCallCandidates,
  subscribeCallDoc,
  updateCallSession,
} from '../lib/socialApi';
import { CallSession, UserProfile } from '../types/social';
import { Avatar } from './Avatar';

interface CallOverlayProps {
  call: CallSession;
  currentUser: UserProfile;
  onClose: () => void;
  onToast: (msg: string) => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export const CallOverlay: React.FC<CallOverlayProps> = ({
  call,
  currentUser,
  onClose,
  onToast,
}) => {
  const [liveCall, setLiveCall] = useState<CallSession>(call);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(call.callType === 'video');
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const answerAppliedRef = useRef(false);

  const isCaller = liveCall.callerId === currentUser.uid;
  const peerName = isCaller ? liveCall.calleeName : liveCall.callerName;
  const peerPhoto = isCaller ? liveCall.calleePhoto : liveCall.callerPhoto;

  const cleanup = () => {
    localStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    localStreamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
  };

  useEffect(() => {
    const unsubDoc = subscribeCallDoc(call.id, (updated) => {
      if (!updated) {
        cleanup();
        onClose();
        return;
      }
      setLiveCall(updated);
      if (['ended', 'declined', 'missed'].includes(updated.status)) {
        cleanup();
        onClose();
      }
    });
    return () => unsubDoc();
  }, [call.id, onClose]);

  useEffect(() => {
    if (liveCall.status !== 'active') return;
    const timer = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [liveCall.status]);

  // Caller initializes PeerConnection and sets offer once overlay mounts
  useEffect(() => {
    if (!isCaller) return;
    let active = true;

    const initCaller = async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: call.callType === 'video',
        });
        if (!active) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = media;
        if (localVideoRef.current && call.callType === 'video') {
          localVideoRef.current.srcObject = media;
        }

        const pc = new RTCPeerConnection(RTC_CONFIG);
        pcRef.current = pc;
        media.getTracks().forEach((t) => pc.addTrack(t, media));

        pc.ontrack = (ev) => {
          const stream = ev.streams[0];
          if (!stream) return;
          if (call.callType === 'video' && remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = stream;
          }
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = stream;
          }
        };

        pc.onicecandidate = (ev) => {
          if (ev.candidate) {
            void addCallCandidate(call.id, currentUser.uid, call.participants, JSON.stringify(ev.candidate));
          }
        };

        if (call.offerSdp) {
          await pc.setLocalDescription(new RTCSessionDescription(JSON.parse(call.offerSdp)));
        }
      } catch (err) {
        setMediaError(err instanceof Error ? err.message : 'Microphone/camera access required for calls');
      }
    };

    void initCaller();

    const unsubIce = subscribeCallCandidates(call.id, currentUser.uid, async (candidateJson) => {
      try {
        if (pcRef.current) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(JSON.parse(candidateJson)));
        }
      } catch {
        // Ignore transient candidate timing error
      }
    });

    return () => {
      active = false;
      unsubIce();
      cleanup();
    };
  }, [call.id, call.offerSdp, call.callType, call.participants, currentUser.uid, isCaller]);

  // Apply callee answer when caller receives it
  useEffect(() => {
    if (!isCaller || !liveCall.answerSdp || answerAppliedRef.current || !pcRef.current) return;
    answerAppliedRef.current = true;
    void pcRef.current
      .setRemoteDescription(new RTCSessionDescription(JSON.parse(liveCall.answerSdp)))
      .catch(() => {});
  }, [isCaller, liveCall.answerSdp]);

  // Callee ICE subscription when active
  useEffect(() => {
    if (isCaller || liveCall.status !== 'active') return;
    const unsubIce = subscribeCallCandidates(call.id, currentUser.uid, async (candidateJson) => {
      try {
        if (pcRef.current) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(JSON.parse(candidateJson)));
        }
      } catch {
        // Ignore transient candidate error
      }
    });
    return () => unsubIce();
  }, [call.id, currentUser.uid, isCaller, liveCall.status]);

  const handleAcceptCall = async () => {
    setMediaError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: liveCall.callType === 'video',
      });
      localStreamRef.current = media;
      if (localVideoRef.current && liveCall.callType === 'video') {
        localVideoRef.current.srcObject = media;
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;
      media.getTracks().forEach((t) => pc.addTrack(t, media));

      pc.ontrack = (ev) => {
        const stream = ev.streams[0];
        if (!stream) return;
        if (liveCall.callType === 'video' && remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
        }
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          void addCallCandidate(liveCall.id, currentUser.uid, liveCall.participants, JSON.stringify(ev.candidate));
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(liveCall.offerSdp)));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await updateCallSession(liveCall.id, {
        status: 'active',
        answerSdp: JSON.stringify(answer),
      });
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Unable to access microphone/camera');
    }
  };

  const handleDeclineOrEnd = async () => {
    const nextStatus = !isCaller && liveCall.status === 'ringing' ? 'declined' : 'ended';
    await updateCallSession(liveCall.id, { status: nextStatus });
    cleanup();
    onToast(nextStatus === 'declined' ? 'Call declined' : 'Call ended');
    onClose();
  };

  const toggleMic = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !micOn;
    });
    setMicOn((v) => !v);
  };

  const toggleCam = () => {
    localStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = !camOn;
    });
    setCamOn((v) => !v);
  };

  const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const secs = String(elapsedSec % 60).padStart(2, '0');

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <audio ref={remoteAudioRef} autoPlay className="hidden" />
      <div className="w-full max-w-md bg-[#121618] text-white border border-[#262C30] rounded-3xl overflow-hidden shadow-2xl">
        {liveCall.callType === 'video' ? (
          <div className="relative h-80 bg-zinc-950 flex items-center justify-center">
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-24 h-32 rounded-2xl object-cover border border-white/20 absolute bottom-3 right-3 bg-black"
            />
            <div className="absolute top-3 left-3 px-3 py-1.5 rounded-xl bg-black/60 backdrop-blur-sm text-xs font-semibold flex items-center gap-2">
              <Video className="w-3.5 h-3.5 text-teal-400" />
              <span>
                {peerName} ·{' '}
                {liveCall.status === 'active' ? `${mins}:${secs}` : isCaller ? 'Ringing...' : 'Incoming Video Call'}
              </span>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center space-y-4">
            <Avatar src={peerPhoto} name={peerName} size="xl" className="mx-auto ring-4 ring-[#0D6E6E]/40" />
            <div>
              <h3 className="font-display text-xl font-bold">{peerName}</h3>
              <p className="text-sm text-zinc-400 mt-1 tabular-nums">
                {liveCall.status === 'active'
                  ? `Connected · ${mins}:${secs}`
                  : isCaller
                    ? 'Calling via WebRTC Voice...'
                    : 'Incoming Voice Call'}
              </p>
            </div>
          </div>
        )}

        {mediaError && (
          <p className="mx-6 mb-3 text-xs text-red-300 bg-red-950/60 border border-red-800 rounded-xl px-3 py-2">
            {mediaError}
          </p>
        )}

        <div className="p-6 border-t border-[#262C30] flex items-center justify-center gap-4">
          {!isCaller && liveCall.status === 'ringing' ? (
            <>
              <button
                type="button"
                onClick={handleDeclineOrEnd}
                className="h-12 px-5 rounded-2xl bg-red-600 hover:bg-red-700 text-sm font-semibold flex items-center gap-2 cursor-pointer"
              >
                <PhoneOff className="w-4 h-4" />
                <span>Decline</span>
              </button>
              <button
                type="button"
                onClick={handleAcceptCall}
                className="h-12 px-6 rounded-2xl bg-[#0D6E6E] hover:bg-[#095454] text-sm font-semibold flex items-center gap-2 cursor-pointer"
              >
                <Phone className="w-4 h-4" />
                <span>Answer</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={toggleMic}
                aria-label="Toggle microphone"
                className={`w-12 h-12 rounded-2xl flex items-center justify-center cursor-pointer ${
                  micOn ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-red-600'
                }`}
              >
                {micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </button>

              {liveCall.callType === 'video' && (
                <button
                  type="button"
                  onClick={toggleCam}
                  aria-label="Toggle camera"
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center cursor-pointer ${
                    camOn ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-red-600'
                  }`}
                >
                  {camOn ? <Camera className="w-5 h-5" /> : <CameraOff className="w-5 h-5" />}
                </button>
              )}

              <button
                type="button"
                onClick={handleDeclineOrEnd}
                aria-label="End call"
                className="w-14 h-12 rounded-2xl bg-red-600 hover:bg-red-700 flex items-center justify-center cursor-pointer"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
