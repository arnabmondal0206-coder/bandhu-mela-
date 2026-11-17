export interface RomanticSoundController {
  setMuted: (muted: boolean) => void;
  stop: () => void;
  isBlocked: () => boolean;
}

const NOTE_FREQS: Record<string, number> = {
  F3: 174.61,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.0,
  A4: 440.0,
  Bb4: 466.16,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  F5: 698.46,
  G5: 783.99,
  A5: 880.0,
};

// Lush 4.8s romantic harp & warm chord sequence (Fmaj7 -> Dm9 -> Bbmaj7 -> Fmaj7)
const HARP_MELODY: Array<{ time: number; note: keyof typeof NOTE_FREQS; dur: number; gain: number }> = [
  { time: 0.04, note: 'F3', dur: 1.8, gain: 0.14 },
  { time: 0.12, note: 'C4', dur: 1.5, gain: 0.12 },
  { time: 0.24, note: 'A4', dur: 1.4, gain: 0.14 },
  { time: 0.42, note: 'C5', dur: 1.4, gain: 0.15 },
  { time: 0.68, note: 'E5', dur: 1.5, gain: 0.16 },
  { time: 0.98, note: 'F5', dur: 1.6, gain: 0.17 },
  { time: 1.32, note: 'D5', dur: 1.6, gain: 0.15 },
  { time: 1.68, note: 'A4', dur: 1.5, gain: 0.13 },
  { time: 2.02, note: 'F5', dur: 1.5, gain: 0.16 },
  { time: 2.38, note: 'E5', dur: 1.4, gain: 0.14 },
  { time: 2.74, note: 'C5', dur: 1.5, gain: 0.15 },
  { time: 3.1, note: 'A5', dur: 1.6, gain: 0.14 },
  { time: 3.45, note: 'G5', dur: 1.3, gain: 0.13 },
  { time: 3.82, note: 'F5', dur: 1.2, gain: 0.15 },
  { time: 4.12, note: 'C5', dur: 1.0, gain: 0.13 },
];

export function playRomanticGiftMelody(initialMuted = false): RomanticSoundController {
  if (typeof window === 'undefined') {
    return { setMuted: () => {}, stop: () => {}, isBlocked: () => false };
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioCtx) {
    return { setMuted: () => {}, stop: () => {}, isBlocked: () => true };
  }

  let stopped = false;
  let muted = initialMuted;
  const ctx = new AudioCtx();
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(muted ? 0 : 0.65, ctx.currentTime);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2200, ctx.currentTime);
  filter.connect(masterGain);
  masterGain.connect(ctx.destination);

  const startAt = ctx.currentTime + 0.04;
  const activeNodes: AudioNode[] = [masterGain, filter];

  const scheduleVoice = (freq: number, offset: number, dur: number, peakGain: number, type: OscillatorType) => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startAt + offset);

    env.gain.setValueAtTime(0.0001, startAt + offset);
    env.gain.linearRampToValueAtTime(peakGain, startAt + offset + 0.035);
    env.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + dur);

    osc.connect(env);
    env.connect(filter);
    osc.start(startAt + offset);
    osc.stop(startAt + offset + dur + 0.05);
    activeNodes.push(osc, env);
  };

  // Warm ambient chord bed (F major warmth) synced to 4.8s
  scheduleVoice(NOTE_FREQS.F3, 0, 4.7, 0.08, 'sine');
  scheduleVoice(NOTE_FREQS.C4, 0.1, 4.5, 0.06, 'triangle');
  scheduleVoice(NOTE_FREQS.A4, 0.1, 4.5, 0.04, 'sine');

  for (const n of HARP_MELODY) {
    const freq = NOTE_FREQS[n.note];
    scheduleVoice(freq, n.time, n.dur, n.gain, 'triangle');
    // Soft octave shimmer
    scheduleVoice(freq * 2, n.time + 0.01, n.dur * 0.75, n.gain * 0.25, 'sine');
  }

  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }

  return {
    setMuted: (nextMuted: boolean) => {
      muted = nextMuted;
      if (stopped) return;
      if (!nextMuted && ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
      masterGain.gain.cancelScheduledValues(ctx.currentTime);
      masterGain.gain.setTargetAtTime(nextMuted ? 0 : 0.65, ctx.currentTime, 0.04);
    },
    isBlocked: () => ctx.state === 'suspended',
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        masterGain.gain.cancelScheduledValues(ctx.currentTime);
        masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      } catch {
        // ignore
      }
      setTimeout(() => {
        void ctx.close().catch(() => {});
      }, 120);
    },
  };
}
