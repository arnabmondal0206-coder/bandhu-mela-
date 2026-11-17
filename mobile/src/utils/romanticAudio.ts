import { Audio } from 'expo-av';

let cachedRomanticWavUri: string | null = null;

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64_CHARS[(triple >> 18) & 63];
    out += BASE64_CHARS[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64_CHARS[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? BASE64_CHARS[triple & 63] : '=';
  }
  return out;
}

function buildRomanticWavDataUri(): string {
  if (cachedRomanticWavUri) return cachedRomanticWavUri;

  const sampleRate = 16000;
  const totalSec = 4.8;
  const numSamples = Math.floor(sampleRate * totalSec);
  const dataSize = numSamples * 2;
  const buffer = new Uint8Array(44 + dataSize);
  const view = new DataView(buffer.buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) {
      buffer[offset + i] = s.charCodeAt(i);
    }
  };

  // Standard 16-bit PCM Mono WAV header
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const notes: Array<{ t: number; f: number; d: number; amp: number }> = [
    { t: 0.05, f: 349.23, d: 1.4, amp: 0.18 }, // F4
    { t: 0.28, f: 440.0, d: 1.3, amp: 0.16 }, // A4
    { t: 0.54, f: 523.25, d: 1.3, amp: 0.17 }, // C5
    { t: 0.84, f: 659.25, d: 1.5, amp: 0.18 }, // E5
    { t: 1.18, f: 698.46, d: 1.6, amp: 0.2 }, // F5
    { t: 1.58, f: 587.33, d: 1.5, amp: 0.18 }, // D5
    { t: 1.98, f: 440.0, d: 1.3, amp: 0.15 }, // A4
    { t: 2.3, f: 698.46, d: 1.4, amp: 0.18 }, // F5
    { t: 2.66, f: 659.25, d: 1.3, amp: 0.16 }, // E5
    { t: 3.02, f: 523.25, d: 1.4, amp: 0.17 }, // C5
    { t: 3.4, f: 880.0, d: 1.3, amp: 0.14 }, // A5
    { t: 3.78, f: 698.46, d: 1.0, amp: 0.18 }, // F5
  ];

  const mix = new Float32Array(numSamples);

  // Subtle warm chord drone (F3 + C4)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const fadeIn = Math.min(1, t / 0.4);
    const fadeOut = Math.min(1, Math.max(0, (totalSec - t) / 0.8));
    const pad =
      (Math.sin(2 * Math.PI * 174.61 * t) * 0.08 + Math.sin(2 * Math.PI * 261.63 * t) * 0.05) *
      fadeIn *
      fadeOut;
    mix[i] += pad;
  }

  for (const n of notes) {
    const startIdx = Math.floor(n.t * sampleRate);
    const lenIdx = Math.min(numSamples - startIdx, Math.floor(n.d * sampleRate));
    for (let j = 0; j < lenIdx; j++) {
      const dt = j / sampleRate;
      const attack = Math.min(1, dt / 0.025);
      const decay = Math.exp((-2.6 * dt) / n.d);
      const tone =
        Math.sin(2 * Math.PI * n.f * dt) * 0.78 +
        Math.sin(2 * Math.PI * n.f * 2 * dt) * 0.22;
      mix[startIdx + j] += tone * n.amp * attack * decay;
    }
  }

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-0.92, Math.min(0.92, mix[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }

  cachedRomanticWavUri = `data:audio/wav;base64,${encodeBase64(buffer)}`;
  return cachedRomanticWavUri;
}

export async function createAndPlayRomanticSound(muted: boolean): Promise<Audio.Sound | null> {
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    const uri = buildRomanticWavDataUri();
    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: true, isMuted: muted, volume: 0.78 }
    );
    return sound;
  } catch {
    return null;
  }
}
