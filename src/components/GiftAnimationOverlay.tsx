import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { GiftEvent } from '../types/social';
import { playRomanticGiftMelody, RomanticSoundController } from '../utils/romanticAudio';

export const LOVE_COUPLE_GIFT_DURATION_MS = 4800;
export const STANDARD_GIFT_DURATION_MS = 3400;

interface GiftAnimationOverlayProps {
  activeGift: (GiftEvent & { animationType?: string }) | null;
  onClose?: () => void;
}

const FLOATING_MINI_HEARTS = [
  { id: 'fh1', left: '10%', bottom: '12%', delay: '0s', dur: '3.6s', size: 22, color: '#FB7185' },
  { id: 'fh2', left: '20%', bottom: '8%', delay: '0.4s', dur: '4.0s', size: 18, color: '#F43F5E' },
  { id: 'fh3', left: '30%', bottom: '16%', delay: '0.85s', dur: '3.4s', size: 26, color: '#FDA4AF' },
  { id: 'fh4', left: '41%', bottom: '6%', delay: '0.25s', dur: '3.9s', size: 16, color: '#FB7185' },
  { id: 'fh5', left: '59%', bottom: '10%', delay: '0.6s', dur: '3.5s', size: 24, color: '#F43F5E' },
  { id: 'fh6', left: '69%', bottom: '14%', delay: '1.1s', dur: '3.8s', size: 19, color: '#FDA4AF' },
  { id: 'fh7', left: '79%', bottom: '7%', delay: '0.3s', dur: '3.7s', size: 25, color: '#E11D48' },
  { id: 'fh8', left: '89%', bottom: '15%', delay: '0.95s', dur: '3.4s', size: 20, color: '#FB7185' },
  { id: 'fh9', left: '15%', bottom: '28%', delay: '1.35s', dur: '3.3s', size: 17, color: '#FDE047' },
  { id: 'fh10', left: '84%', bottom: '26%', delay: '1.2s', dur: '3.5s', size: 18, color: '#FBBF24' },
];

const SPARKLE_STARS = [
  { id: 'sp1', top: '16%', left: '18%', delay: '0.1s', dur: '1.7s', size: 22, color: '#FDE047' },
  { id: 'sp2', top: '20%', left: '78%', delay: '0.45s', dur: '1.9s', size: 24, color: '#FBBF24' },
  { id: 'sp3', top: '36%', left: '11%', delay: '0.7s', dur: '1.6s', size: 18, color: '#FDA4AF' },
  { id: 'sp4', top: '38%', left: '87%', delay: '0.25s', dur: '1.8s', size: 20, color: '#FDE047' },
  { id: 'sp5', top: '58%', left: '14%', delay: '0.55s', dur: '2.0s', size: 22, color: '#FBBF24' },
  { id: 'sp6', top: '57%', left: '84%', delay: '0.85s', dur: '1.7s', size: 22, color: '#FDA4AF' },
  { id: 'sp7', top: '12%', left: '50%', delay: '0.3s', dur: '1.5s', size: 20, color: '#FDE047' },
  { id: 'sp8', top: '66%', left: '34%', delay: '0.65s', dur: '1.9s', size: 16, color: '#FDE047' },
  { id: 'sp9', top: '66%', left: '66%', delay: '0.2s', dur: '1.8s', size: 16, color: '#FBBF24' },
  { id: 'sp10', top: '26%', left: '34%', delay: '0.9s', dur: '1.6s', size: 15, color: '#FFF1F2' },
];

const HEART_SVG_PATH =
  'M120 206 C116 203 22 142 22 76 C22 41 49 16 82 16 C101 16 113 26 120 38 C127 26 139 16 158 16 C191 16 218 41 218 76 C218 142 124 203 120 206 Z';

export function isLoveCoupleGift(gift: (GiftEvent & { animationType?: string }) | null | undefined): boolean {
  if (!gift) return false;
  return (
    gift.giftId === 'gift_love_couple' ||
    gift.animationType === 'couple_love' ||
    gift.giftName.toLowerCase().includes('love couple')
  );
}

const VectorHeart: React.FC<{ size: number; color: string; className?: string }> = ({ size, color, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
      fill={color}
    />
  </svg>
);

const VectorSparkle: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 1.5L14.4 9.6L22.5 12L14.4 14.4L12 22.5L9.6 14.4L1.5 12L9.6 9.6L12 1.5Z"
      fill={color}
    />
  </svg>
);

export const GiftAnimationOverlay: React.FC<GiftAnimationOverlayProps> = ({ activeGift, onClose }) => {
  const isLoveCouple = isLoveCoupleGift(activeGift);
  const [soundMuted, setSoundMuted] = useState(false);
  const soundRef = useRef<RomanticSoundController | null>(null);

  useEffect(() => {
    if (!activeGift || !isLoveCouple) {
      soundRef.current?.stop();
      soundRef.current = null;
      return;
    }

    const controller = playRomanticGiftMelody(soundMuted);
    soundRef.current = controller;

    return () => {
      controller.stop();
      if (soundRef.current === controller) {
        soundRef.current = null;
      }
    };
  }, [activeGift?.id, isLoveCouple]);

  const handleToggleMute = () => {
    const next = !soundMuted;
    setSoundMuted(next);
    soundRef.current?.setMuted(next);
  };

  return (
    <AnimatePresence>
      {activeGift && isLoveCouple && (
        <motion.div
          key={`love_${activeGift.id}`}
          data-testid="love-couple-gift-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center p-4 sm:p-6 overflow-hidden bg-gradient-to-b from-[#1A051D]/90 via-[#2E0728]/90 to-[#140417]/90 backdrop-blur-md"
        >
          {/* Soft Atmospheric Radial Glow */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <motion.div
              animate={{ scale: [0.85, 1.18, 0.94, 1.12], opacity: [0.35, 0.8, 0.55, 0.72] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
              className="w-[340px] h-[340px] sm:w-[520px] sm:h-[520px] rounded-full bg-radial from-rose-500/45 via-amber-400/20 to-transparent blur-3xl"
            />
          </div>

          {/* Expanding Soft Glow Rings triggered right as the two hearts unite */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 1, 2].map((ringIdx) => (
              <motion.div
                key={ringIdx}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: [0.55, 1.65], opacity: [0, 0.75, 0] }}
                transition={{
                  duration: 2.3,
                  delay: 0.85 + ringIdx * 0.65,
                  repeat: Infinity,
                  ease: 'easeOut',
                }}
                className="absolute w-64 h-64 sm:w-80 sm:h-80 rounded-full border-2 border-rose-300/60 shadow-[0_0_40px_rgba(244,63,94,0.55)]"
              />
            ))}
          </div>

          {/* Floating Small SVG Hearts & Sparkle Particles */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {FLOATING_MINI_HEARTS.map((item) => (
              <div
                key={item.id}
                style={
                  {
                    left: item.left,
                    bottom: item.bottom,
                    '--delay': item.delay,
                    '--dur': item.dur,
                  } as React.CSSProperties
                }
                className="bm-love-float absolute select-none drop-shadow-[0_0_12px_rgba(244,63,94,0.85)]"
              >
                <VectorHeart size={item.size} color={item.color} />
              </div>
            ))}

            {SPARKLE_STARS.map((sp) => (
              <div
                key={sp.id}
                style={
                  {
                    top: sp.top,
                    left: sp.left,
                    '--delay': sp.delay,
                    '--dur': sp.dur,
                  } as React.CSSProperties
                }
                className="bm-love-sparkle absolute select-none drop-shadow-[0_0_10px_rgba(253,224,71,0.95)]"
              >
                <VectorSparkle size={sp.size} color={sp.color} />
              </div>
            ))}
          </div>

          {/* Top Controls: Title + Mute + Return */}
          <div className="absolute top-4 inset-x-4 sm:top-6 sm:inset-x-8 z-30 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-rose-500/20 border border-rose-300/40 text-rose-100 backdrop-blur-md">
              <Heart className="w-4 h-4 text-rose-400 fill-rose-400 animate-pulse" />
              <span className="text-xs sm:text-sm font-bold tracking-wide uppercase text-amber-200">
                Love Couple Gift
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleMute}
                aria-label={soundMuted ? 'Unmute romantic sound' : 'Mute romantic sound'}
                className="min-h-[42px] px-3.5 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-semibold flex items-center gap-1.5 backdrop-blur-md cursor-pointer transition-colors"
              >
                {soundMuted ? (
                  <>
                    <VolumeX className="w-4 h-4 text-rose-300" />
                    <span>Unmute</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-4 h-4 text-amber-300" />
                    <span>Mute</span>
                  </>
                )}
              </button>

              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Return to Audio Room"
                  className="min-h-[42px] min-w-[42px] px-3.5 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-semibold flex items-center justify-center gap-1.5 backdrop-blur-md cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4" />
                  <span className="hidden sm:inline">Close</span>
                </button>
              )}
            </div>
          </div>

          {/* Center-Screen Choreographed Animation Stage */}
          <div className="relative z-20 flex flex-col items-center text-center max-w-md w-full mt-6">
            <div
              data-testid="love-couple-heart-stage"
              className="relative w-72 h-64 sm:w-84 sm:h-72 flex items-center justify-center"
            >
              {/* Phase 1 (0s - 1.1s): Left Animated Red Heart gliding toward center */}
              <motion.div
                data-testid="merging-heart-left"
                initial={{ x: -165, y: 12, scale: 0.7, rotate: -22, opacity: 0 }}
                animate={{
                  x: [-165, -75, 0],
                  y: [12, -10, 0],
                  scale: [0.7, 0.92, 1.05],
                  rotate: [-22, -10, 0],
                  opacity: [0, 1, 1, 0],
                }}
                transition={{
                  duration: 1.15,
                  times: [0, 0.45, 0.85, 1],
                  ease: 'easeInOut',
                }}
                className="pointer-events-none absolute flex items-center justify-center drop-shadow-[0_0_25px_rgba(244,63,94,0.9)]"
              >
                <svg width="136" height="126" viewBox="0 0 240 220" aria-hidden="true">
                  <defs>
                    <linearGradient id="bmLeftHeartGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#FB7185" />
                      <stop offset="55%" stopColor="#E11D48" />
                      <stop offset="100%" stopColor="#9F1239" />
                    </linearGradient>
                  </defs>
                  <path d={HEART_SVG_PATH} fill="url(#bmLeftHeartGrad)" stroke="#FECDD3" strokeWidth="4" />
                </svg>
              </motion.div>

              {/* Phase 1 (0s - 1.1s): Right Animated Red Heart gliding toward center */}
              <motion.div
                data-testid="merging-heart-right"
                initial={{ x: 165, y: 12, scale: 0.7, rotate: 22, opacity: 0 }}
                animate={{
                  x: [165, 75, 0],
                  y: [12, -10, 0],
                  scale: [0.7, 0.92, 1.05],
                  rotate: [22, 10, 0],
                  opacity: [0, 1, 1, 0],
                }}
                transition={{
                  duration: 1.15,
                  times: [0, 0.45, 0.85, 1],
                  ease: 'easeInOut',
                }}
                className="pointer-events-none absolute flex items-center justify-center drop-shadow-[0_0_25px_rgba(244,63,94,0.9)]"
              >
                <svg width="136" height="126" viewBox="0 0 240 220" aria-hidden="true">
                  <defs>
                    <linearGradient id="bmRightHeartGrad" x1="100%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#FB7185" />
                      <stop offset="55%" stopColor="#E11D48" />
                      <stop offset="100%" stopColor="#9F1239" />
                    </linearGradient>
                  </defs>
                  <path d={HEART_SVG_PATH} fill="url(#bmRightHeartGrad)" stroke="#FDE047" strokeWidth="4" />
                </svg>
              </motion.div>

              {/* Unity Burst Flash at moment the two hearts merge (~0.95s) */}
              <motion.div
                initial={{ scale: 0.2, opacity: 0 }}
                animate={{ scale: [0.2, 1.45, 1.8], opacity: [0, 0.9, 0] }}
                transition={{ duration: 0.85, delay: 0.85, ease: 'easeOut' }}
                className="pointer-events-none absolute w-48 h-48 rounded-full bg-radial from-amber-200/80 via-rose-400/50 to-transparent blur-md"
              />

              {/* Phase 2 (0.85s - 4.8s): One Big Glowing Red Heart + Cute Animated Couple Inside */}
              <motion.div
                data-testid="merged-glowing-heart"
                initial={{ scale: 0.35, opacity: 0 }}
                animate={{
                  scale: [0.35, 1.1, 0.98, 1.04, 0.99, 1.03],
                  opacity: [0, 1, 1, 1, 1, 1],
                }}
                transition={{
                  delay: 0.82,
                  duration: 3.9,
                  times: [0, 0.14, 0.3, 0.52, 0.76, 1],
                  ease: 'easeInOut',
                }}
                className="relative flex items-center justify-center drop-shadow-[0_0_45px_rgba(244,63,94,0.9)]"
              >
                <svg
                  viewBox="0 0 240 220"
                  className="w-64 h-60 sm:w-76 sm:h-72 overflow-visible"
                  role="img"
                  aria-label="Glowing red heart with animated embracing romantic couple inside"
                >
                  <defs>
                    <radialGradient id="bmBigHeartFill" cx="50%" cy="40%" r="60%">
                      <stop offset="0%" stopColor="#FF8FA3" />
                      <stop offset="42%" stopColor="#F43F5E" />
                      <stop offset="82%" stopColor="#BE123C" />
                      <stop offset="100%" stopColor="#881337" />
                    </radialGradient>
                    <radialGradient id="bmInnerSpotlight" cx="50%" cy="54%" r="44%">
                      <stop offset="0%" stopColor="#FFF1F2" stopOpacity="0.45" />
                      <stop offset="60%" stopColor="#FDA4AF" stopOpacity="0.16" />
                      <stop offset="100%" stopColor="#881337" stopOpacity="0" />
                    </radialGradient>
                    <linearGradient id="bmHeartRim" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#FDE68A" />
                      <stop offset="50%" stopColor="#FECDD3" />
                      <stop offset="100%" stopColor="#FBBF24" />
                    </linearGradient>
                    <linearGradient id="bmCoupleSilhouetteL" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#FFE4E6" />
                      <stop offset="100%" stopColor="#FECDD3" />
                    </linearGradient>
                    <linearGradient id="bmCoupleSilhouetteR" x1="100%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#FEF3C7" />
                      <stop offset="100%" stopColor="#FDE68A" />
                    </linearGradient>
                    <clipPath id="bmBigHeartClip">
                      <path d={HEART_SVG_PATH} />
                    </clipPath>
                  </defs>

                  {/* Soft Outer Radiant Halo */}
                  <path
                    d={HEART_SVG_PATH}
                    fill="none"
                    stroke="#FB7185"
                    strokeOpacity="0.38"
                    strokeWidth="14"
                  />

                  {/* Big Glowing Heart Body */}
                  <path
                    d={HEART_SVG_PATH}
                    fill="url(#bmBigHeartFill)"
                    stroke="url(#bmHeartRim)"
                    strokeWidth="4.5"
                  />

                  {/* Warm Inner Spotlight & Shimmer */}
                  <g clipPath="url(#bmBigHeartClip)">
                    <ellipse cx="120" cy="118" rx="76" ry="64" fill="url(#bmInnerSpotlight)" />
                    {/* Glossy Upper Left Heart Reflection */}
                    <path
                      d="M52 54 C60 36 82 32 95 40 C80 42 66 52 58 68 Z"
                      fill="#FFFFFF"
                      fillOpacity="0.28"
                    />

                    {/* Cute Animated Romantic Couple Inside the Glowing Heart */}
                    <g data-testid="animated-couple-characters">
                      {/* Left Romantic Partner leaning gently inward */}
                      <motion.g
                        animate={{ rotate: [0, 3.2, 0.8, 3.2, 0], x: [0, 2.5, 0.5, 2.5, 0] }}
                        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                        style={{ transformOrigin: '96px 148px' }}
                      >
                        {/* Soft Hair & Head */}
                        <circle cx="94" cy="84" r="17" fill="#3B0764" />
                        <circle cx="96" cy="86" r="14.5" fill="url(#bmCoupleSilhouetteL)" />
                        {/* Cute Blush & Happy Eyes */}
                        <ellipse cx="102" cy="89" rx="3.4" ry="2" fill="#FB7185" fillOpacity="0.65" />
                        <path
                          d="M99 83 Q101.5 80.5 104 83"
                          stroke="#881337"
                          strokeWidth="2"
                          strokeLinecap="round"
                          fill="none"
                        />
                        {/* Torso & Flowing Scarf/Jacket */}
                        <path
                          d="M72 154 C72 122 83 105 98 105 C110 105 117 118 119 154 Z"
                          fill="#4C0519"
                        />
                        <path
                          d="M78 154 C79 125 87 109 98 109 C108 109 114 122 115 154 Z"
                          fill="url(#bmCoupleSilhouetteL)"
                          fillOpacity="0.92"
                        />
                        {/* Embracing Arm reaching across */}
                        <path
                          d="M102 117 C115 119 124 123 132 129"
                          stroke="#FECDD3"
                          strokeWidth="7"
                          strokeLinecap="round"
                          fill="none"
                        />
                      </motion.g>

                      {/* Right Romantic Partner leaning tenderly inward */}
                      <motion.g
                        animate={{ rotate: [0, -3.2, -0.8, -3.2, 0], x: [0, -2.5, -0.5, -2.5, 0] }}
                        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                        style={{ transformOrigin: '144px 148px' }}
                      >
                        {/* Long Flowing Hair & Head */}
                        <path
                          d="M128 84 C128 69 140 62 152 66 C163 70 167 84 164 106 C158 101 151 98 144 98 Z"
                          fill="#3B0764"
                        />
                        <circle cx="143" cy="88" r="14" fill="url(#bmCoupleSilhouetteR)" />
                        {/* Cute Blush & Happy Eyes */}
                        <ellipse cx="137" cy="91" rx="3.4" ry="2" fill="#F43F5E" fillOpacity="0.6" />
                        <path
                          d="M135 85 Q137.5 82.5 140 85"
                          stroke="#881337"
                          strokeWidth="2"
                          strokeLinecap="round"
                          fill="none"
                        />
                        {/* Dress / Torso Silhouette */}
                        <path
                          d="M120 154 C123 120 130 107 142 107 C155 107 166 125 168 154 Z"
                          fill="#831843"
                        />
                        <path
                          d="M124 154 C126 123 132 111 142 111 C152 111 160 126 162 154 Z"
                          fill="url(#bmCoupleSilhouetteR)"
                          fillOpacity="0.94"
                        />
                        {/* Embracing Arm */}
                        <path
                          d="M136 119 C125 121 116 125 108 131"
                          stroke="#FDE68A"
                          strokeWidth="6.5"
                          strokeLinecap="round"
                          fill="none"
                        />
                      </motion.g>

                      {/* Floating Tiny Glowing Heart Between the Embracing Couple */}
                      <motion.g
                        animate={{
                          y: [0, -6, 0],
                          scale: [0.9, 1.22, 0.9],
                          opacity: [0.85, 1, 0.85],
                        }}
                        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                        style={{ transformOrigin: '120px 64px' }}
                      >
                        <path
                          d="M120 73 C118.5 71.8 109 64.5 109 57.5 C109 53.6 112 51 115.6 51 C117.7 51 119.2 52.1 120 53.5 C120.8 52.1 122.3 51 124.4 51 C128 51 131 53.6 131 57.5 C131 64.5 121.5 71.8 120 73 Z"
                          fill="#FDE047"
                          stroke="#FFF1F2"
                          strokeWidth="1.5"
                        />
                      </motion.g>
                    </g>
                  </g>
                </svg>
              </motion.div>
            </div>

            {/* Sender, Recipient & Coin Value Card */}
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.45 }}
              className="mt-3 w-full rounded-3xl bg-white/12 border border-amber-300/45 backdrop-blur-xl px-5 py-4 shadow-2xl space-y-1.5"
            >
              <p className="font-display text-lg sm:text-xl font-extrabold text-white tracking-tight">
                <span className="text-amber-300">{activeGift.senderName}</span> sent Love Couple Gift
              </p>
              <p className="text-sm sm:text-base font-semibold text-rose-100">
                To: <span className="text-white font-extrabold">{activeGift.recipientName}</span>
              </p>
              <div className="pt-0.5 flex items-center justify-center gap-1.5 text-amber-300 font-display text-sm sm:text-base font-extrabold tabular-nums">
                <Sparkles className="w-4 h-4" />
                <span>{activeGift.coinsCost} Coins</span>
              </div>

              {/* 4.8s Smooth Auto-Return Progress Bar */}
              <div className="pt-2">
                <div className="w-full h-1.5 rounded-full bg-white/15 overflow-hidden">
                  <motion.div
                    initial={{ width: '100%' }}
                    animate={{ width: '0%' }}
                    transition={{ duration: LOVE_COUPLE_GIFT_DURATION_MS / 1000, ease: 'linear' }}
                    className="h-full bg-gradient-to-r from-rose-400 via-amber-300 to-rose-400"
                  />
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}

      {activeGift && !isLoveCouple && (
        <motion.div
          key={activeGift.id}
          data-testid="standard-gift-banner"
          initial={{ opacity: 0, y: 40, scale: 0.7 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -36, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4"
        >
          <div className="relative bg-zinc-950/90 dark:bg-[#101416]/95 border border-amber-400/60 text-white rounded-3xl px-6 py-4 shadow-2xl flex items-center gap-4 max-w-md overflow-hidden">
            <motion.div
              animate={{
                scale: [1, 1.28, 1],
                rotate: activeGift.animationType === 'crown' ? [0, -10, 10, 0] : [0, 8, -8, 0],
              }}
              transition={{ duration: 0.9, repeat: 2 }}
              className="text-5xl select-none shrink-0"
            >
              {activeGift.giftEmoji}
            </motion.div>

            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                BANDHU MELA Gift Celebration
              </p>
              <p className="text-sm font-bold truncate mt-0.5">
                {activeGift.senderName} sent {activeGift.giftName}
              </p>
              <p className="text-xs text-zinc-300 truncate">
                To <span className="text-teal-300 font-semibold">{activeGift.recipientName}</span> ·{' '}
                <span className="tabular-nums font-semibold text-amber-300">
                  {activeGift.coinsCost} coins
                </span>
              </p>
            </div>

            {[0, 1, 2, 3, 4].map((idx) => (
              <motion.span
                key={idx}
                initial={{ opacity: 0, y: 12, x: (idx - 2) * 18 }}
                animate={{ opacity: [0, 1, 0], y: -34 - idx * 6 }}
                transition={{ duration: 1.4, delay: idx * 0.12 }}
                className="absolute right-6 bottom-2 text-base select-none"
              >
                {activeGift.giftEmoji}
              </motion.span>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
