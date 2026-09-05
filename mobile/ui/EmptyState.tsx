import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, space } from '../theme';

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  compact?: boolean;
}

// Replaces the old one-liner `<Text style={emptyText}>italic gray
// sentence</Text>` used for every "nothing here yet" case - a plain italic
// caption is the laziest possible empty state. An icon + a real two-line
// message reads as a screen someone actually designed for the empty case,
// not just a fallback string.
export default function EmptyState({ icon, title, subtitle, compact }: EmptyStateProps) {
  return (
    <View style={[styles.container, { paddingVertical: compact ? space.xl : space.xxxl }]}>
      <View style={styles.iconRing}>
        <Ionicons name={icon} size={26} color={colors.textFaint} />
      </View>
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
  title: { color: colors.textDim, fontFamily: font.bodySemi, fontSize: 14, textAlign: 'center' },
  subtitle: { color: colors.textFaint, fontFamily: font.body, fontSize: 12.5, textAlign: 'center', marginTop: 4, lineHeight: 18 },
});
