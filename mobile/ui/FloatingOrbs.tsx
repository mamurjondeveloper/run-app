import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

interface Orb {
  size: number;
  color: string;
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  driftX: number;
  driftY: number;
  duration: number;
  opacity: number;
}

const ORBS: Orb[] = [
  { size: 260, color: colors.accent, top: -80, left: -60, driftX: 22, driftY: 30, duration: 7000, opacity: 0.16 },
  { size: 170, color: colors.accentDeep, top: 140, right: -50, driftX: -18, driftY: 26, duration: 5600, opacity: 0.14 },
  { size: 130, color: colors.amber, bottom: 120, left: -40, driftX: 16, driftY: -20, duration: 6400, opacity: 0.1 },
];

function FloatingOrb({ orb }: { orb: Orb }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: orb.duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: orb.duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t, orb.duration]);

  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [0, orb.driftX] });
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, orb.driftY] });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        width: orb.size,
        height: orb.size,
        borderRadius: orb.size / 2,
        backgroundColor: orb.color,
        opacity: orb.opacity,
        top: orb.top,
        bottom: orb.bottom,
        left: orb.left,
        right: orb.right,
        transform: [{ translateX }, { translateY }],
      }}
    />
  );
}

// A single static gradient blob (the old loginGlow) reads fine as a
// screenshot but sits dead still the entire time someone looks at it. Three
// soft color fields drifting on their own slow, staggered loops turn the
// same "designed glow" trick into something that feels alive without ever
// asking for attention - the kind of ambient motion a template rarely
// bothers with.
export default function FloatingOrbs() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {ORBS.map((orb, i) => (
        <FloatingOrb key={i} orb={orb} />
      ))}
    </View>
  );
}
