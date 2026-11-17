import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { GiftEvent } from '../types/social';
import { createAndPlayRomanticSound } from '../utils/romanticAudio';

export const LOVE_COUPLE_GIFT_DURATION_MS = 4800;
export const STANDARD_GIFT_DURATION_MS = 3000;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const FLOATING_HEARTS = [
  { id: 'fh1', left: 0.08, size: 16, color: '#FB7185', delay: 0, dur: 3400 },
  { id: 'fh2', left: 0.19, size: 14, color: '#F43F5E', delay: 320, dur: 3600 },
  { id: 'fh3', left: 0.31, size: 18, color: '#FDA4AF', delay: 650, dur: 3200 },
  { id: 'fh4', left: 0.44, size: 13, color: '#FB7185', delay: 180, dur: 3500 },
  { id: 'fh5', left: 0.57, size: 17, color: '#F43F5E', delay: 500, dur: 3300 },
  { id: 'fh6', left: 0.69, size: 15, color: '#FDA4AF', delay: 820, dur: 3500 },
  { id: 'fh7', left: 0.80, size: 18, color: '#E11D48', delay: 220, dur: 3400 },
  { id: 'fh8', left: 0.90, size: 14, color: '#FBBF24', delay: 580, dur: 3200 },
];

const SPARKLE_NODES = [
  { id: 'sp1', top: 0.19, left: 0.16, size: 12, color: '#FDE047', delay: 100 },
  { id: 'sp2', top: 0.22, left: 0.80, size: 14, color: '#FBBF24', delay: 380 },
  { id: 'sp3', top: 0.37, left: 0.10, size: 11, color: '#FECDD3', delay: 620 },
  { id: 'sp4', top: 0.39, left: 0.88, size: 12, color: '#FDE047', delay: 250 },
  { id: 'sp5', top: 0.56, left: 0.15, size: 13, color: '#FBBF24', delay: 480 },
  { id: 'sp6', top: 0.55, left: 0.83, size: 13, color: '#FDA4AF', delay: 750 },
  { id: 'sp7', top: 0.14, left: 0.49, size: 12, color: '#FDE047', delay: 200 },
  { id: 'sp8', top: 0.63, left: 0.35, size: 10, color: '#FFF1F2', delay: 540 },
];

interface GeometricHeartProps {
  size: number;
  color: string;
  innerGlowColor?: string;
}

const GeometricHeart: React.FC<GeometricHeartProps> = ({ size, color, innerGlowColor }) => {
  const lobeSize = Math.round(size * 0.56);
  const squareSize = Math.round(size * 0.56);
  const topOffset = Math.round(size * 0.08);
  const centerTop = Math.round(size * 0.22);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          top: topOffset,
          left: Math.round(size * 0.04),
          width: lobeSize,
          height: lobeSize,
          borderRadius: lobeSize / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: topOffset,
          right: Math.round(size * 0.04),
          width: lobeSize,
          height: lobeSize,
          borderRadius: lobeSize / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: centerTop,
          width: squareSize,
          height: squareSize,
          backgroundColor: color,
          borderRadius: Math.round(size * 0.06),
          transform: [{ rotate: '45deg' }],
        }}
      />
      {innerGlowColor && (
        <View
          style={{
            position: 'absolute',
            top: Math.round(size * 0.16),
            left: Math.round(size * 0.16),
            width: Math.round(size * 0.22),
            height: Math.round(size * 0.14),
            borderRadius: Math.round(size * 0.1),
            backgroundColor: innerGlowColor,
            opacity: 0.32,
            transform: [{ rotate: '-25deg' }],
          }}
        />
      )}
    </View>
  );
};

interface LoveCoupleGiftModalProps {
  gift: (GiftEvent & { animationType?: string }) | null;
  onClose: () => void;
}

export function isLoveCoupleGiftMobile(gift: (GiftEvent & { animationType?: string }) | null | undefined): boolean {
  if (!gift) return false;
  return (
    gift.giftId === 'gift_love_couple' ||
    gift.animationType === 'couple_love' ||
    gift.giftName.toLowerCase().includes('love couple')
  );
}

export const LoveCoupleGiftModal: React.FC<LoveCoupleGiftModalProps> = ({ gift, onClose }) => {
  const [muted, setMuted] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  const mergeProgress = useRef(new Animated.Value(0)).current;
  const bigHeartAppear = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const coupleSway = useRef(new Animated.Value(0)).current;
  const ringAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(1)).current;
  const floatAnims = useRef(FLOATING_HEARTS.map(() => new Animated.Value(0))).current;
  const sparkleAnims = useRef(SPARKLE_NODES.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!gift) return;

    let active = true;
    void createAndPlayRomanticSound(muted).then((snd) => {
      if (!active) {
        void snd?.unloadAsync().catch(() => {});
        return;
      }
      soundRef.current = snd;
    });

    mergeProgress.setValue(0);
    bigHeartAppear.setValue(0);
    pulseAnim.setValue(0);
    coupleSway.setValue(0);
    ringAnim.setValue(0);
    progressAnim.setValue(1);
    floatAnims.forEach((a) => a.setValue(0));
    sparkleAnims.forEach((a) => a.setValue(0));

    // Phase 1: Two red hearts glide together & merge into one big glowing heart
    const mergeSequence = Animated.sequence([
      Animated.timing(mergeProgress, {
        toValue: 1,
        duration: 1050,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    const bigHeartReveal = Animated.sequence([
      Animated.delay(820),
      Animated.spring(bigHeartAppear, {
        toValue: 1,
        friction: 5,
        tension: 65,
        useNativeDriver: true,
      }),
    ]);

    const heartbeatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 850,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 850,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    const swayLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(coupleSway, {
          toValue: 1,
          duration: 1300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(coupleSway, {
          toValue: 0,
          duration: 1300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    const ringLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(700),
        Animated.timing(ringAnim, {
          toValue: 1,
          duration: 2000,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ringAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );

    const progressTimer = Animated.timing(progressAnim, {
      toValue: 0,
      duration: LOVE_COUPLE_GIFT_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    });

    const floatLoops = floatAnims.map((anim, idx) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(FLOATING_HEARTS[idx].delay),
          Animated.timing(anim, {
            toValue: 1,
            duration: FLOATING_HEARTS[idx].dur,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      )
    );

    const sparkleLoops = sparkleAnims.map((anim, idx) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(SPARKLE_NODES[idx].delay),
          Animated.timing(anim, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      )
    );

    mergeSequence.start();
    bigHeartReveal.start();
    heartbeatLoop.start();
    swayLoop.start();
    ringLoop.start();
    progressTimer.start();
    floatLoops.forEach((l) => l.start());
    sparkleLoops.forEach((l) => l.start());

    return () => {
      active = false;
      mergeSequence.stop();
      bigHeartReveal.stop();
      heartbeatLoop.stop();
      swayLoop.stop();
      ringLoop.stop();
      progressTimer.stop();
      floatLoops.forEach((l) => l.stop());
      sparkleLoops.forEach((l) => l.stop());
      if (soundRef.current) {
        void soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
    };
  }, [gift?.id]);

  const toggleMute = async () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (soundRef.current) {
      await soundRef.current.setIsMutedAsync(nextMuted).catch(() => {});
    }
  };

  if (!gift) return null;

  const leftHeartX = mergeProgress.interpolate({ inputRange: [0, 0.85, 1], outputRange: [-150, 0, 0] });
  const rightHeartX = mergeProgress.interpolate({ inputRange: [0, 0.85, 1], outputRange: [150, 0, 0] });
  const sideHeartScale = mergeProgress.interpolate({ inputRange: [0, 0.82, 1], outputRange: [0.7, 1.04, 1.15] });
  const sideHeartOpacity = mergeProgress.interpolate({ inputRange: [0, 0.15, 0.84, 1], outputRange: [0, 1, 1, 0] });
  const leftHeartTilt = mergeProgress.interpolate({ inputRange: [0, 1], outputRange: ['-18deg', '0deg'] });
  const rightHeartTilt = mergeProgress.interpolate({ inputRange: [0, 1], outputRange: ['18deg', '0deg'] });

  const bigHeartScale = Animated.multiply(
    bigHeartAppear.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
    pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.05] })
  );
  const leftPartnerTilt = coupleSway.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '4deg'] });
  const rightPartnerTilt = coupleSway.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-4deg'] });
  const miniHeartBounce = coupleSway.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });

  const ringScale = ringAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.58] });
  const ringOpacity = ringAnim.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.75, 0.5, 0] });
  const progressWidth = progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <Modal visible={Boolean(gift)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Expanding Soft Glow Aura & Ring */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glowHalo,
            {
              opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.65] }),
              transform: [{ scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] }) }],
            },
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.goldRing,
            {
              opacity: ringOpacity,
              transform: [{ scale: ringScale }],
            },
          ]}
        />

        {/* Floating Small Geometric Hearts */}
        {FLOATING_HEARTS.map((fh, idx) => {
          const translateY = floatAnims[idx].interpolate({
            inputRange: [0, 1],
            outputRange: [SCREEN_H * 0.42, -SCREEN_H * 0.44],
          });
          const pOpacity = floatAnims[idx].interpolate({
            inputRange: [0, 0.16, 0.82, 1],
            outputRange: [0, 0.95, 0.9, 0],
          });
          return (
            <Animated.View
              key={fh.id}
              pointerEvents="none"
              style={{
                position: 'absolute',
                bottom: '34%',
                left: Math.round(SCREEN_W * fh.left),
                opacity: pOpacity,
                transform: [{ translateY }],
              }}
            >
              <GeometricHeart size={fh.size} color={fh.color} />
            </Animated.View>
          );
        })}

        {/* Twinkling Sparkle Particles */}
        {SPARKLE_NODES.map((sp, idx) => {
          const scale = sparkleAnims[idx].interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.3] });
          const opacity = sparkleAnims[idx].interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
          return (
            <Animated.View
              key={sp.id}
              pointerEvents="none"
              style={[
                styles.sparkleDiamond,
                {
                  top: Math.round(SCREEN_H * sp.top),
                  left: Math.round(SCREEN_W * sp.left),
                  width: sp.size,
                  height: sp.size,
                  backgroundColor: sp.color,
                  opacity,
                  transform: [{ scale }, { rotate: '45deg' }],
                },
              ]}
            />
          );
        })}

        {/* Top Bar Controls (Mute & Close) */}
        <View style={styles.topBar}>
          <View style={styles.titleTag}>
            <Ionicons name="heart" size={14} color="#FB7185" />
            <Text style={styles.titleTagText}>LOVE COUPLE GIFT</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={toggleMute} style={styles.controlBtn} accessibilityLabel="Toggle romantic music">
              <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={18} color="#FDE68A" />
              <Text style={styles.controlBtnText}>{muted ? 'Unmute' : 'Mute'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={styles.controlBtn} accessibilityLabel="Return to Audio Room">
              <Ionicons name="close" size={18} color="#FFF" />
              <Text style={styles.controlBtnText}>Room</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Center-Screen Merging Hearts -> Big Glowing Heart + Animated Couple */}
        <View style={styles.heartStage}>
          {/* Phase 1: Left Red Heart coming in */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.mergingHeartWrap,
              {
                opacity: sideHeartOpacity,
                transform: [{ translateX: leftHeartX }, { rotate: leftHeartTilt }, { scale: sideHeartScale }],
              },
            ]}
          >
            <GeometricHeart size={118} color="#E11D48" innerGlowColor="#FFFFFF" />
          </Animated.View>

          {/* Phase 1: Right Red Heart coming in */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.mergingHeartWrap,
              {
                opacity: sideHeartOpacity,
                transform: [{ translateX: rightHeartX }, { rotate: rightHeartTilt }, { scale: sideHeartScale }],
              },
            ]}
          >
            <GeometricHeart size={118} color="#F43F5E" innerGlowColor="#FFFFFF" />
          </Animated.View>

          {/* Phase 2: One Big Glowing Red Heart with Cute Animated Couple Inside */}
          <Animated.View
            style={[
              styles.bigHeartWrap,
              {
                opacity: bigHeartAppear,
                transform: [{ scale: bigHeartScale }],
              },
            ]}
          >
            <GeometricHeart size={236} color="#E11D48" innerGlowColor="#FFF1F2" />

            {/* Soft Rose Inner Glow Disc */}
            <View style={styles.innerCoupleGlow} />

            {/* Cute Animated Romantic Couple Embracing Inside the Heart */}
            <View style={styles.coupleScene}>
              {/* Pulsing Tiny Golden Heart Between Couple */}
              <Animated.View style={{ marginBottom: 4, transform: [{ translateY: miniHeartBounce }] }}>
                <GeometricHeart size={20} color="#FDE047" />
              </Animated.View>

              <View style={styles.couplePairRow}>
                {/* Left Partner */}
                <Animated.View style={[styles.characterCol, { transform: [{ rotate: leftPartnerTilt }] }]}>
                  <View style={[styles.charHair, { backgroundColor: '#3B0764' }]} />
                  <View style={[styles.charHead, { backgroundColor: '#FFE4E6' }]}>
                    <View style={styles.charBlush} />
                  </View>
                  <View style={[styles.charTorso, { backgroundColor: '#FECDD3' }]} />
                  <View style={[styles.embraceArmLeft, { backgroundColor: '#FECDD3' }]} />
                </Animated.View>

                {/* Right Partner */}
                <Animated.View style={[styles.characterCol, { transform: [{ rotate: rightPartnerTilt }] }]}>
                  <View style={[styles.charHairLong, { backgroundColor: '#3B0764' }]} />
                  <View style={[styles.charHead, { backgroundColor: '#FEF3C7' }]}>
                    <View style={styles.charBlush} />
                  </View>
                  <View style={[styles.charTorso, { backgroundColor: '#FDE68A' }]} />
                  <View style={[styles.embraceArmRight, { backgroundColor: '#FDE68A' }]} />
                </Animated.View>
              </View>
            </View>
          </Animated.View>
        </View>

        {/* Sender & Recipient Names + Coin Value Card */}
        <View style={styles.infoCard}>
          <Text style={styles.senderLine}>
            <Text style={{ color: '#FDE047' }}>{gift.senderName}</Text> sent Love Couple Gift
          </Text>
          <Text style={styles.receiverLine}>
            To: <Text style={{ color: '#FFF', fontWeight: '900' }}>{gift.recipientName}</Text>
          </Text>
          <Text style={styles.coinsLine}>{gift.coinsCost} Coins</Text>

          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(24, 5, 29, 0.90)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  topBar: {
    position: 'absolute',
    top: 48,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 20,
  },
  titleTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(244, 63, 94, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(253, 224, 71, 0.45)',
  },
  titleTagText: { color: '#FDE68A', fontSize: 12, fontWeight: '800' },
  controlBtn: {
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  controlBtnText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  glowHalo: {
    position: 'absolute',
    width: 310,
    height: 310,
    borderRadius: 155,
    backgroundColor: 'rgba(244, 63, 94, 0.34)',
  },
  goldRing: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    borderWidth: 2.5,
    borderColor: '#FDA4AF',
  },
  sparkleDiamond: {
    position: 'absolute',
    borderRadius: 2,
    shadowColor: '#FDE047',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
  heartStage: {
    width: 270,
    height: 250,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  mergingHeartWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F43F5E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 20,
    elevation: 14,
  },
  bigHeartWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F43F5E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 28,
    elevation: 18,
  },
  innerCoupleGlow: {
    position: 'absolute',
    width: 122,
    height: 122,
    borderRadius: 61,
    top: 56,
    backgroundColor: 'rgba(255, 241, 242, 0.20)',
  },
  coupleScene: {
    position: 'absolute',
    top: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  couplePairRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
  },
  characterCol: {
    alignItems: 'center',
    width: 44,
  },
  charHair: {
    width: 28,
    height: 14,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    marginBottom: -6,
    zIndex: 2,
  },
  charHairLong: {
    width: 30,
    height: 26,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    marginBottom: -18,
    zIndex: 0,
  },
  charHead: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 5,
    zIndex: 1,
  },
  charBlush: {
    width: 8,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(244, 63, 94, 0.55)',
  },
  charTorso: {
    width: 32,
    height: 36,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    marginTop: 2,
  },
  embraceArmLeft: {
    position: 'absolute',
    top: 38,
    right: -6,
    width: 18,
    height: 7,
    borderRadius: 4,
    transform: [{ rotate: '12deg' }],
  },
  embraceArmRight: {
    position: 'absolute',
    top: 38,
    left: -6,
    width: 18,
    height: 7,
    borderRadius: 4,
    transform: [{ rotate: '-12deg' }],
  },
  infoCard: {
    marginTop: 18,
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    padding: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.45)',
    alignItems: 'center',
    gap: 5,
  },
  senderLine: { color: '#FFF', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  receiverLine: { color: '#FECDD3', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  coinsLine: { color: '#FDE047', fontSize: 16, fontWeight: '900', marginTop: 2 },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
    marginTop: 8,
  },
  progressFill: { height: '100%', backgroundColor: '#FBBF24' },
});
