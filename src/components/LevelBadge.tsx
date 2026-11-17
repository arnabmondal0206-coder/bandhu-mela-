import React from 'react';
import { Calendar, Crown, Sparkles, Timer } from 'lucide-react';
import {
  computeLevelSummary,
  DEFAULT_LEVEL_CONFIG,
  formatSpeakingDuration,
  getMonthlyResetCountdown,
} from '../lib/levelVipApi';
import { LevelConfig, SpeakingMonthHistory, SpeakingStats } from '../types/social';

interface LevelBadgeProps {
  stats: SpeakingStats | null | undefined;
  config?: LevelConfig;
  compact?: boolean;
}

export const LevelBadge: React.FC<LevelBadgeProps> = ({
  stats,
  config = DEFAULT_LEVEL_CONFIG,
  compact = false,
}) => {
  const summary = computeLevelSummary(stats, config);
  if (!summary.currentTier) {
    if (compact) return null;
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
        <span>🎙️</span>
        <span>Newcomer</span>
      </span>
    );
  }

  return (
    <span
      style={{ borderColor: summary.currentTier.badgeColor, color: summary.currentTier.badgeColor }}
      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-white/80 dark:bg-[#0E1113]/80"
    >
      <span>{summary.currentTier.badgeEmoji}</span>
      <span>
        Lv.{summary.currentTier.level} {summary.currentTier.name}
      </span>
    </span>
  );
};

interface LevelProgressCardProps {
  stats: SpeakingStats | null | undefined;
  history?: SpeakingMonthHistory[];
  config?: LevelConfig;
  isOwnProfile?: boolean;
}

export const LevelProgressCard: React.FC<LevelProgressCardProps> = ({
  stats,
  history = [],
  config = DEFAULT_LEVEL_CONFIG,
  isOwnProfile = false,
}) => {
  const summary = computeLevelSummary(stats, config);
  const countdown = getMonthlyResetCountdown();

  return (
    <div className="bg-white dark:bg-[#14131D] border border-[#E7E3F0] dark:border-[#252336] rounded-3xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-10 h-10 rounded-2xl flex items-center justify-center text-lg ${
              summary.isVip
                ? 'bg-gradient-to-br from-orange-400 via-pink-500 to-violet-600 text-white shadow-sm'
                : 'bg-violet-500/12 text-violet-600 dark:text-violet-400'
            }`}
          >
            {summary.currentTier?.badgeEmoji || '🎙️'}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-display text-sm font-bold">
                {summary.currentTier
                  ? `Level ${summary.currentTier.level} · ${summary.currentTier.name}`
                  : 'Starter · Speak 1h to reach Beginner'}
              </h3>
              <LevelBadge stats={stats} config={config} />
            </div>
            <p className="text-xs text-zinc-500 flex items-center gap-1.5 mt-0.5 tabular-nums">
              <Timer className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
              <span>
                This Month: <strong>{formatSpeakingDuration(summary.activeSeconds)}</strong>
              </span>
              <span>·</span>
              <Calendar className="w-3.5 h-3.5" />
              <span>
                Resets {countdown.resetLabel} ({countdown.days}d {countdown.hours}h left)
              </span>
            </p>
          </div>
        </div>

        <span className="text-xs font-bold text-violet-600 dark:text-violet-400 tabular-nums">
          {summary.remainingLabel}
        </span>
      </div>

      {/* Progress bar toward next tier */}
      <div className="space-y-1.5">
        <div className="w-full h-3 rounded-full bg-[#F8F7FB] dark:bg-[#0B0B10] overflow-hidden border border-[#E7E3F0] dark:border-[#252336]">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              summary.isVip
                ? 'bandhu-gradient'
                : 'bg-gradient-to-r from-violet-600 to-pink-500'
            }`}
            style={{ width: `${summary.progressPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-zinc-500 tabular-nums">
          <span>{summary.progressPct}% of current tier goal</span>
          <span>
            {summary.nextTier ? `Next: Lv.${summary.nextTier.level} ${summary.nextTier.name} (${summary.nextTier.minHours}h)` : 'VIP Max Tier Reached'}
          </span>
        </div>
      </div>

      {/* All 5 Levels Ladder */}
      <div className="grid grid-cols-5 gap-1.5 pt-1">
        {config.levels.map((tier) => {
          const unlocked = summary.currentLevel >= tier.level;
          return (
            <div
              key={tier.level}
              className={`rounded-2xl p-2 text-center border transition-colors ${
                unlocked
                  ? 'border-amber-400 bg-amber-500/10'
                  : 'border-[#E4DFD5] dark:border-[#262C30] bg-[#F7F5F0]/50 dark:bg-[#0E1113]/50 opacity-65'
              }`}
            >
              <div className="text-base leading-none">{tier.badgeEmoji}</div>
              <p className="text-[10px] font-bold mt-1 truncate">{tier.name}</p>
              <p className="text-[10px] text-zinc-500 tabular-nums">{tier.minHours}h</p>
            </div>
          );
        })}
      </div>

      {/* VIP Perks Status */}
      <div className="rounded-2xl bg-[#F7F5F0] dark:bg-[#0E1113] p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 font-semibold">
          {summary.isVip ? (
            <>
              <Crown className="w-4 h-4 text-amber-500" />
              <span className="text-amber-600 dark:text-amber-400">
                VIP Active until {countdown.resetLabel}: Frame · Gold Name · Exclusive Emojis · VIP Rooms · Stage Entry FX
              </span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 text-[#0D6E6E] dark:text-teal-400" />
              <span className="text-zinc-600 dark:text-zinc-400">
                Reach {config.levels[4]?.minHours || 100}h live speaking this month to unlock VIP Frame, Gold Name, Emojis &amp; VIP Rooms
              </span>
            </>
          )}
        </div>
      </div>

      {/* Monthly Level History */}
      {(history.length > 0 || isOwnProfile) && (
        <div className="pt-2 border-t border-[#E4DFD5] dark:border-[#262C30] space-y-2">
          <p className="text-xs font-bold text-zinc-500">Monthly Speaking History</p>
          {history.length === 0 ? (
            <p className="text-xs text-zinc-500">
              Completed months appear here automatically after the 1st-of-month cycle reset.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {history.slice(0, 4).map((h) => (
                <div
                  key={h.monthKey}
                  className="rounded-xl border border-[#E4DFD5] dark:border-[#262C30] px-3 py-2 flex items-center justify-between text-xs"
                >
                  <div>
                    <p className="font-bold">{h.monthKey}</p>
                    <p className="text-[11px] text-zinc-500">
                      Lv.{h.achievedLevel} {h.levelName} {h.wasVip ? '👑 VIP' : ''}
                    </p>
                  </div>
                  <span className="font-mono font-bold tabular-nums text-[#0D6E6E] dark:text-teal-400">
                    {formatSpeakingDuration(h.speakingSeconds)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
