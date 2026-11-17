import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PALETTE } from '../i18n/translations';
import {
  computeLevelSummary,
  DEFAULT_LEVEL_CONFIG,
  formatSpeakingDuration,
  getMonthlyResetCountdown,
} from '../services/api';
import { LevelConfig, SpeakingMonthHistory, SpeakingStats } from '../types/social';

interface LevelBadgeProps {
  stats?: SpeakingStats | null;
  config?: LevelConfig;
  compact?: boolean;
}

export const LevelBadge: React.FC<LevelBadgeProps> = ({
  stats,
  config = DEFAULT_LEVEL_CONFIG,
  compact = true,
}) => {
  const summary = computeLevelSummary(stats, config);
  if (summary.currentLevel === 0) return null;
  const tier = summary.currentTier;
  if (!tier) return null;

  return (
    <View
      style={[
        styles.badge,
        {
          borderColor: summary.isVip ? '#F59E0B' : tier.badgeColor,
          backgroundColor: summary.isVip ? '#F59E0B22' : `${tier.badgeColor}18`,
          paddingHorizontal: compact ? 6 : 10,
          paddingVertical: compact ? 2 : 4,
        },
      ]}
    >
      <Text style={{ fontSize: compact ? 10 : 12 }}>{tier.badgeEmoji}</Text>
      <Text
        style={{
          fontSize: compact ? 10 : 11,
          fontWeight: '800',
          color: summary.isVip ? '#D97706' : tier.badgeColor,
        }}
      >
        Lv.{tier.level} {tier.name}
      </Text>
    </View>
  );
};

interface LevelProgressCardProps {
  stats?: SpeakingStats | null;
  config?: LevelConfig;
  history?: SpeakingMonthHistory[];
  darkMode: boolean;
}

export const LevelProgressCard: React.FC<LevelProgressCardProps> = ({
  stats,
  config = DEFAULT_LEVEL_CONFIG,
  history = [],
  darkMode,
}) => {
  const c = darkMode ? PALETTE.dark : PALETTE.light;
  const summary = computeLevelSummary(stats, config);
  const reset = getMonthlyResetCountdown();
  const tiers = [...(config.levels?.length === 5 ? config.levels : DEFAULT_LEVEL_CONFIG.levels)].sort(
    (a, b) => a.level - b.level
  );

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: summary.isVip ? '#F59E0B' : c.border }]}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="mic-outline" size={16} color={c.teal} />
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>Monthly Audio Level &amp; VIP</Text>
          </View>
          <Text style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
            Resets 1st of every month · {reset.days}d {reset.hours}h left ({reset.resetLabel} UTC)
          </Text>
        </View>
        {summary.currentTier ? (
          <LevelBadge stats={stats} config={config} compact={false} />
        ) : (
          <View style={[styles.badge, { borderColor: c.border, backgroundColor: c.bg, paddingHorizontal: 8, paddingVertical: 3 }]}>
            <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700' }}>Level 0</Text>
          </View>
        )}
      </View>

      {/* Progress Bar */}
      <View style={{ marginTop: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={{ color: c.text, fontWeight: '700', fontSize: 12 }}>
            Active Speaking: <Text style={{ color: c.teal }}>{formatSpeakingDuration(summary.activeSeconds)}</Text>
          </Text>
          <Text style={{ color: summary.isVip ? '#D97706' : c.muted, fontWeight: '700', fontSize: 11 }}>
            {summary.remainingLabel}
          </Text>
        </View>
        <View style={[styles.track, { backgroundColor: c.bg, borderColor: c.border }]}>
          <View
            style={[
              styles.fill,
              {
                width: `${summary.progressPct}%`,
                backgroundColor: summary.isVip ? '#F59E0B' : c.teal,
              },
            ]}
          />
        </View>
      </View>

      {/* VIP Perks Status */}
      {summary.isVip && (
        <View style={[styles.vipBanner, { backgroundColor: '#F59E0B1A', borderColor: '#F59E0B55' }]}>
          <Text style={{ color: '#D97706', fontWeight: '800', fontSize: 12 }}>👑 Monthly VIP Active</Text>
          <Text style={{ color: c.text, fontSize: 11, marginTop: 2 }}>
            Unlocked:{' '}
            {[
              config.enableVipFrames && 'Golden Frame',
              config.enableVipNameColors && 'VIP Name Color',
              config.enableVipExclusiveEmojis && 'VIP Emojis',
              config.enableVipRoomAccess && 'VIP Rooms',
              config.enableVipEntryAnimation && 'Grand Entry',
            ]
              .filter(Boolean)
              .join(' • ')}
          </Text>
        </View>
      )}

      {/* 5 Tiers Ladder */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
        {tiers.map((tier) => {
          const unlocked = summary.currentLevel >= tier.level;
          return (
            <View
              key={tier.level}
              style={[
                styles.tierChip,
                {
                  borderColor: unlocked ? tier.badgeColor : c.border,
                  backgroundColor: unlocked ? `${tier.badgeColor}18` : c.bg,
                },
              ]}
            >
              <Text style={{ fontSize: 13 }}>{tier.badgeEmoji}</Text>
              <View>
                <Text style={{ color: unlocked ? c.text : c.muted, fontWeight: '800', fontSize: 11 }}>
                  Lv.{tier.level} {tier.name}
                </Text>
                <Text style={{ color: c.muted, fontSize: 10 }}>{tier.minHours}h</Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Monthly History */}
      {history.length > 0 && (
        <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border, gap: 4 }}>
          <Text style={{ color: c.muted, fontSize: 11, fontWeight: '800' }}>PAST MONTHS HISTORY</Text>
          {history.slice(0, 6).map((h) => (
            <View key={h.monthKey} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: c.text, fontSize: 12, fontWeight: '700' }}>
                {h.monthKey} · {h.wasVip ? '👑 VIP' : `Lv.${h.achievedLevel} ${h.levelName}`}
              </Text>
              <Text style={{ color: c.teal, fontSize: 12, fontWeight: '700' }}>
                {formatSpeakingDuration(h.speakingSeconds)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  track: {
    height: 10,
    borderRadius: 999,
    borderWidth: 1,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
  vipBanner: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
  },
  tierChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
});
