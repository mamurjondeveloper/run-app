import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

const PALETTE = [colors.accent, colors.amber, colors.gold, colors.silver, colors.accentDeep, '#FF8FA3'];
const PIECE_COUNT = 26;

interface Piece {
  angle: number;
  distance: number;
  size: number;
  color: string;
  rotations: number;
  delay: number;
  shape: 'square' | 'circle';
}

function makePieces(): Piece[] {
  const pieces: Piece[] = [];
  for (let i = 0; i < PIECE_COUNT; i++) {
    pieces.push({
      angle: (Math.PI * 2 * i) / PIECE_COUNT + (Math.random() - 0.5) * 0.6,
      distance: 90 + Math.random() * 150,
      size: 6 + Math.random() * 7,
      color: PALETTE[i % PALETTE.length],
      rotations: 1.5 + Math.random() * 2.5,
      delay: Math.random() * 120,
      shape: Math.random() > 0.5 ? 'square' : 'circle',
    });
  }
  return pieces;
}

// A trophy emoji sitting still is a fine icon; a trophy emoji with two dozen
// bits of color exploding outward from behind it for one second is a
// celebration - the difference between an app that logged your run and one
// that's genuinely glad you finished it. Fires once on mount, no loop, no
// libraries: each piece is one Animated.Value driving distance/rotation/fade
// together.
export default function Confetti({ trigger }: { trigger: number }) {
  const piecesRef = useRef<Piece[]>(makePieces());
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    piecesRef.current = makePieces();
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 1100,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [trigger, progress]);

  return (
    <View style={styles.root} pointerEvents="none">
      {piecesRef.current.map((p, i) => {
        const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(p.angle) * p.distance] });
        const translateY = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, Math.sin(p.angle) * p.distance * 0.7 + 60],
        });
        const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.rotations * 360}deg`] });
        const opacity = progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] });
        const scale = progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0.6] });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              width: p.size,
              height: p.size,
              borderRadius: p.shape === 'circle' ? p.size / 2 : 2,
              backgroundColor: p.color,
              opacity,
              transform: [{ translateX }, { translateY }, { rotate }, { scale }],
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
