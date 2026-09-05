import React, { useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme';

interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

// A plain row of separately-colored chips (the old periodTab styling) can
// only ever "snap" between states. A single pill that slides under
// whichever label is active is the detail that makes a tab switcher feel
// like a native iOS/Material segmented control instead of a row of buttons
// someone forgot to link together.
export default function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  const [containerWidth, setContainerWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const segmentWidth = containerWidth / options.length;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setContainerWidth(w);
    const idx = options.findIndex((o) => o.value === value);
    translateX.setValue((idx >= 0 ? idx : 0) * (w / options.length));
  };

  const select = (idx: number) => {
    Animated.spring(translateX, {
      toValue: idx * segmentWidth,
      useNativeDriver: true,
      speed: 16,
      bounciness: 8,
    }).start();
    onChange(options[idx].value);
  };

  return (
    <View style={styles.track} onLayout={onLayout}>
      {containerWidth > 0 && (
        <Animated.View
          style={[
            styles.thumb,
            { width: segmentWidth - 6, transform: [{ translateX: Animated.add(translateX, new Animated.Value(3)) }] },
          ]}
        />
      )}
      {options.map((opt, idx) => (
        <Pressable key={opt.value} style={styles.segment} onPress={() => select(idx)} hitSlop={4}>
          <Text style={[styles.label, value === opt.value && styles.labelActive]}>{opt.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.bg1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    height: 44,
    position: 'relative',
  },
  thumb: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 0,
    backgroundColor: colors.accent,
    borderRadius: radius.md - 3,
  },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.textDim, fontFamily: font.bodyBold, fontSize: 12.5 },
  labelActive: { color: colors.onAccent },
});
