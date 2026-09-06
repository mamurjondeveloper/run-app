import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, ViewStyle } from 'react-native';
import { colors, radius } from '../theme';

interface SkeletonBlockProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

// A bare ActivityIndicator spinner on first load tells the user nothing
// about what's about to appear - one frame it's a blank dark screen with a
// dot spinning in the middle, the next it's a full layout of stat cards and
// rows. A pulsing placeholder shaped like the real content (used below to
// build HomeSkeleton/LeaderboardSkeleton/HistorySkeleton) reads as "this is
// already loading, here's its shape" instead.
export function SkeletonBlock({ width = '100%', height = 16, radius: r = radius.sm, style }: SkeletonBlockProps) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.85, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: r, backgroundColor: colors.bg2, opacity },
        style,
      ]}
    />
  );
}
