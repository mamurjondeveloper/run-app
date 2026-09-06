import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, space } from '../theme';

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  compact?: boolean;
  /** A large emoji "sticker" shown above the icon ring instead of leaving
   *  the empty state as a bare icon+caption - the detail that makes "no
   *  data yet" feel like a friendly illustration instead of a fallback. */
  sticker?: string;
}

// Replaces the old one-liner `<Text style={emptyText}>italic gray
// sentence</Text>` used for every "nothing here yet" case - a plain italic
// caption is the laziest possible empty state. An icon + a real two-line
// message reads as a screen someone actually designed for the empty case,
// not just a fallback string.
export default function EmptyState({ icon, title, subtitle, compact, sticker }: EmptyStateProps) {
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!sticker) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob, sticker]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });

  return (
    <View style={[styles.container, { paddingVertical: compact ? space.xl : space.xxxl }]}>
      {sticker ? (
        <Animated.View style={[styles.stickerWrap, { transform: [{ translateY }] }]}>
          <Text style={styles.sticker}>{sticker}</Text>
        </Animated.View>
      ) : (
        <View style={styles.iconRing}>
          <Ionicons name={icon} size={26} color={colors.textFaint} />
        </View>
      )}
      <Text style={styles.title}>{title}</Text>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  iconRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  stickerWrap: {
    width: 84,
    height: 84,
    borderRadius: radius.xl,
    backgroundColor: colors.bg1,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  sticker: { fontSize: 40 },
  title: { color: colors.textDim, fontFamily: font.bodySemi, fontSize: 14, textAlign: 'center' },
  subtitle: { color: colors.textFaint, fontFamily: font.body, fontSize: 12.5, textAlign: 'center', marginTop: 4, lineHeight: 18 },
});
