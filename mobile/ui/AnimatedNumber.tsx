import React, { useEffect, useRef, useState } from 'react';
import { Animated, TextStyle } from 'react-native';

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  duration?: number;
  style?: TextStyle | TextStyle[];
}

// Every number on Home used to just appear - correct, but static text is
// the cheapest possible way to show a stat. Counting up from zero over half
// a second is what makes a total feel like it was just tallied for you
// rather than printed on a label. Uses a plain (non-native-driver) Animated
// listener since it drives text content, not a transform/opacity.
export default function AnimatedNumber({ value, decimals = 0, duration = 700, style }: AnimatedNumberProps) {
  const anim = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState('0');

  useEffect(() => {
    const id = anim.addListener(({ value: v }) => setDisplay(v.toFixed(decimals)));
    Animated.timing(anim, { toValue: value, duration, useNativeDriver: false }).start();
    return () => anim.removeListener(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <Animated.Text style={style}>{display}</Animated.Text>;
}
