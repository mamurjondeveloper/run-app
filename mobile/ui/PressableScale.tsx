import React, { useRef } from 'react';
import { Animated, Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** How far it shrinks on press - 0.96 (subtle, default) for big CTAs, 0.9 for small chips/icons. */
  scaleTo?: number;
  /** Haptic buzz on press - 'light' (default) for everyday taps, 'medium' for a
   *  more consequential action (starting/stopping a run), false to opt out
   *  entirely (e.g. a control that already fires many times per second). */
  haptic?: 'light' | 'medium' | false;
  children: React.ReactNode;
}

// Every TouchableOpacity in the old design just dimmed to 0.7 opacity on
// press - the flattest, most default feedback available, and the single
// biggest tell of an unstyled/template app. A tiny spring-back scale (plus,
// now, a matching haptic tick) on every primary tap is a one-line-of-intent
// change that reads as "someone actually touched this," at effectively no
// perf cost (native driver for the animation, fire-and-forget for haptics).
export default function PressableScale({
  style,
  scaleTo = 0.96,
  haptic = 'light',
  onPressIn,
  onPressOut,
  onPress,
  disabled,
  children,
  ...rest
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;

  return (
    // `style` (including flex/margin/width) goes on Pressable itself - same
    // place callers already put layout styles on a plain TouchableOpacity -
    // so this drops in as a replacement without also having to rework every
    // call site's surrounding flex layout. Only the scale transform lives on
    // the inner Animated.View, which stays unstyled otherwise so it doesn't
    // interfere with Pressable's normal flex sizing.
    <Pressable
      style={style}
      disabled={disabled}
      onPressIn={(e) => {
        Animated.spring(scale, { toValue: scaleTo, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic && !disabled) {
          const style = haptic === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light;
          Haptics.impactAsync(style).catch(() => {});
        }
        onPress?.(e);
      }}
      {...rest}
    >
      <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
    </Pressable>
  );
}
