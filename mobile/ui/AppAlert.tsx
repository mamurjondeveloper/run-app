import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import PressableScale from './PressableScale';
import { colors, font, radius, space, shadow } from '../theme';

export interface AppAlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface AlertState {
  title: string;
  message?: string;
  buttons: AppAlertButton[];
}

// React Native's Alert.alert() draws the OS's own light-themed system
// dialog - on every device, regardless of the app's own dark theme. Every
// single one of the ~20 places this app used it (login errors, permission
// prompts, the "run saved" confirmation) broke the illusion of a designed
// app with a flash of a plain white Android/iOS box. showAlert() is a
// drop-in replacement with the same (title, message, buttons) signature,
// rendered as a themed modal that actually belongs to this app.
let listener: ((state: AlertState | null) => void) | null = null;

export function showAlert(title: string, message?: string, buttons?: AppAlertButton[]) {
  listener?.({ title, message, buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }] });
}

export default function AppAlertHost() {
  const [state, setState] = useState<AlertState | null>(null);

  useEffect(() => {
    listener = setState;
    return () => {
      listener = null;
    };
  }, []);

  const dismiss = (btn: AppAlertButton) => {
    setState(null);
    // Let the modal's own close animation start before running the
    // caller's handler (e.g. one that immediately opens another alert).
    setTimeout(() => btn.onPress?.(), 0);
  };

  const isRow = !!state && state.buttons.length <= 2;

  return (
    <Modal transparent animationType="fade" visible={!!state} onRequestClose={() => state && dismiss(state.buttons[0])}>
      {state && (
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.title}>{state.title}</Text>
            {!!state.message && <Text style={styles.message}>{state.message}</Text>}
            <View style={[styles.buttonRow, !isRow && styles.buttonColumn]}>
              {state.buttons.map((btn, idx) => (
                <PressableScale
                  key={idx}
                  onPress={() => dismiss(btn)}
                  style={[
                    styles.button,
                    isRow && { flex: 1 },
                    btn.style === 'cancel' && styles.buttonCancel,
                    btn.style === 'destructive' && styles.buttonDestructive,
                  ]}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      btn.style === 'cancel' && styles.buttonTextCancel,
                      btn.style === 'destructive' && styles.buttonTextDestructive,
                    ]}
                  >
                    {btn.text}
                  </Text>
                </PressableScale>
              ))}
            </View>
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4,5,7,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.bg1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: space.xl,
    ...shadow.raised,
  },
  title: { color: colors.text, fontSize: 17, fontFamily: font.bodyExtraBold, textAlign: 'center' },
  message: { color: colors.textDim, fontSize: 13.5, fontFamily: font.bodyMedium, textAlign: 'center', marginTop: space.sm, lineHeight: 19 },
  buttonRow: { flexDirection: 'row', gap: space.sm, marginTop: space.xl },
  buttonColumn: { flexDirection: 'column' },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonCancel: { backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.border },
  buttonDestructive: { backgroundColor: colors.danger },
  buttonText: { color: colors.onAccent, fontFamily: font.bodyBold, fontSize: 14.5 },
  buttonTextCancel: { color: colors.textDim },
  buttonTextDestructive: { color: '#fff' },
});
