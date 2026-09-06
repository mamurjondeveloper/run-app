import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import PressableScale from './PressableScale';
import Confetti from './Confetti';
import AnimatedNumber from './AnimatedNumber';
import { colors, font, radius, space, shadow } from '../theme';

export interface CelebrationData {
  distanceKm: number;
  /** null when the run finished offline - the server (not the client)
   *  decides points, so there's nothing honest to show yet. */
  pointsEarned: number | null;
  durationSec: number;
  warning?: string | null;
  /** True when this run couldn't reach the server at all (offline start
   *  and/or finish) and is queued to sync automatically once back online. */
  pending?: boolean;
}

interface CelebrationModalProps {
  data: CelebrationData | null;
  onClose: () => void;
}

const STICKERS = ['🏆', '🎉', '🔥', '💪', '🥇'];

// The finish-run moment used to be a plain themed alert with a line of text
// - correct information, zero occasion. This is the one moment in the whole
// app where a person just did something physically hard; it's worth a
// proper full-screen beat (confetti, a big trophy, numbers ticking up) the
// way Strava/Nike Run Club treat it, instead of a dialog box that looks
// identical to a password-mismatch error.
export default function CelebrationModal({ data, onClose }: CelebrationModalProps) {
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const stickerBounce = useRef(new Animated.Value(0)).current;
  const [confettiTrigger, setConfettiTrigger] = React.useState(0);
  const sticker = useRef(STICKERS[Math.floor(Math.random() * STICKERS.length)]).current;

  useEffect(() => {
    if (!data) return;
    scale.setValue(0.85);
    opacity.setValue(0);
    stickerBounce.setValue(0);
    setConfettiTrigger((n) => n + 1);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 10 }),
      Animated.sequence([
        Animated.delay(150),
        Animated.spring(stickerBounce, { toValue: 1, useNativeDriver: true, speed: 10, bounciness: 18 }),
      ]),
    ]).start();
  }, [data, scale, opacity, stickerBounce]);

  const minutes = data ? Math.floor(data.durationSec / 60) : 0;
  const seconds = data ? data.durationSec % 60 : 0;

  return (
    <Modal transparent animationType="fade" visible={!!data} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {!!data && (
          <>
            <Confetti trigger={confettiTrigger} />
            <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
              <Animated.Text
                style={[
                  styles.sticker,
                  {
                    transform: [
                      { scale: stickerBounce },
                      {
                        rotate: stickerBounce.interpolate({ inputRange: [0, 1], outputRange: ['-20deg', '0deg'] }),
                      },
                    ],
                  },
                ]}
              >
                {sticker}
              </Animated.Text>
              <Text style={styles.title}>Ajoyib yugurish!</Text>
              <Text style={styles.subtitle}>Siz o&apos;z zonangizdan chiqdingiz</Text>

              <View style={styles.statsRow}>
                <View style={styles.statBlock}>
                  <AnimatedNumber value={data.distanceKm} decimals={2} style={styles.statValue as any} />
                  <Text style={styles.statLabel}>KM</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBlock}>
                  <Text style={styles.statValue}>
                    {minutes}:{seconds.toString().padStart(2, '0')}
                  </Text>
                  <Text style={styles.statLabel}>VAQT</Text>
                </View>
              </View>

              {data.pointsEarned != null ? (
                <LinearGradient colors={[colors.accentSoft, 'transparent']} style={styles.pointsRow}>
                  <Text style={styles.pointsIcon}>✨</Text>
                  <AnimatedNumber value={data.pointsEarned} style={styles.pointsValue as any} />
                  <Text style={styles.pointsLabel}>ball to&apos;plandi</Text>
                </LinearGradient>
              ) : (
                <View style={styles.pendingRow}>
                  <Text style={styles.pointsIcon}>📡</Text>
                  <Text style={styles.pendingText}>
                    Internet yo&apos;q edi — yugurish saqlandi va ulanish tiklanganda avtomatik yuboriladi. Ballar shunda hisoblanadi.
                  </Text>
                </View>
              )}

              {!!data.warning && <Text style={styles.warning}>{data.warning}</Text>}

              <PressableScale onPress={onClose} haptic="medium" style={{ width: '100%', marginTop: space.lg }}>
                <LinearGradient colors={[colors.accent, colors.accentDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.button}>
                  <Text style={styles.buttonText}>Davom etish</Text>
                </LinearGradient>
              </PressableScale>
            </Animated.View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4,5,7,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.bg1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.xl,
    padding: space.xxl,
    alignItems: 'center',
    ...shadow.raised,
  },
  sticker: { fontSize: 56, marginBottom: space.sm },
  title: { color: colors.text, fontSize: 24, fontFamily: font.display, textAlign: 'center' },
  subtitle: { color: colors.textDim, fontSize: 13, fontFamily: font.bodyMedium, marginTop: 4, textAlign: 'center' },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: space.xl, marginTop: space.xl },
  statBlock: { alignItems: 'center' },
  statValue: { color: colors.text, fontSize: 32, fontFamily: font.display, lineHeight: 38 },
  statLabel: { color: colors.textFaint, fontSize: 11, fontFamily: font.bodyExtraBold, letterSpacing: 1.5, marginTop: 2 },
  statDivider: { width: 1, height: 36, backgroundColor: colors.border },
  pointsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xl,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
  },
  pointsIcon: { fontSize: 16 },
  pointsValue: { color: colors.accent, fontSize: 18, fontFamily: font.bodyExtraBold },
  pointsLabel: { color: colors.textDim, fontSize: 13, fontFamily: font.bodyMedium },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    marginTop: space.xl,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.warningSoft,
  },
  pendingText: { flex: 1, color: colors.warning, fontSize: 12, fontFamily: font.bodyMedium, lineHeight: 17 },
  warning: { color: colors.warning, fontSize: 12, fontFamily: font.bodyMedium, textAlign: 'center', marginTop: space.md, lineHeight: 17 },
  button: { height: 52, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: colors.onAccent, fontSize: 15, fontFamily: font.bodyExtraBold },
});
