import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

// The "recording" dot next to YOZILMOQDA used to just sit there as a static
// red circle - a genuinely live, minutes-long recording state deserves a
// heartbeat, not a painted icon. A soft looping pulse ring behind a solid
// core dot is the classic "this is live" affordance (video call indicators,
// recording lights) done with a single Animated.loop, no extra deps.
export default function PulseDot({ color = '#ef4444', size = 8 }: { color?: string; size?: number }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] });
  const opacity = pulse.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.5, 0.15, 0] });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: size / 2, backgroundColor: color, transform: [{ scale }], opacity },
        ]}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}
