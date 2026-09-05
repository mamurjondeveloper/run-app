import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, font } from '../theme';

interface AvatarProps {
  uri?: string | null;
  name: string;
  size?: number;
  ring?: boolean;
}

// One shared avatar component instead of the same "image if present, else a
// tinted circle with initials" JSX block copy-pasted at every call site
// (leaderboard row x2, profile header) - each with its own slightly
// different sizing. A ring option marks "this one is you" without needing
// a whole separate row style.
export default function Avatar({ uri, name, size = 36, ring }: AvatarProps) {
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: ring ? 2 : 0,
          borderColor: colors.accent,
        },
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill as any} />
      ) : (
        <Text style={[styles.initials, { fontSize: size * 0.34 }]}>{initials}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: { color: colors.accent, fontFamily: font.bodyExtraBold },
});
