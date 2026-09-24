import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { AppLoader } from '@/components/app-loader';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { getGradients, radius, spacing, typography } from '@/theme/dashboard';
import { isFileEngineAvailable, markFileAccessAsked, requestFileAccess, wasFileAccessAsked } from '@/features/files/file-access';

/** One-time start prompt. Dismisses before the native permission dialog so Android can present it. */
export function FileAccessPrompt({ ready }: { ready: boolean }) {
  const colors = usePalette();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready || wasFileAccessAsked() || !isFileEngineAvailable()) return;
    const timer = setTimeout(() => setVisible(true), 450);
    return () => clearTimeout(timer);
  }, [ready]);

  async function allow() {
    if (busy) return;
    setBusy(true);
    // Hide the JS modal first — Android permission dialogs fail or hide behind an open Modal.
    setVisible(false);
    await new Promise<void>(resolve => setTimeout(resolve, 280));
    try { await requestFileAccess(); } finally { setBusy(false); }
  }

  function skip() {
    markFileAccessAsked();
    setVisible(false);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={skip} statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: `${colors.systemBackground}CC` }]}>
        <View style={[styles.card, getGradients(colors).module, { borderColor: colors.moduleBorder, boxShadow: colors.moduleShadow }]}>
          <View style={[styles.icon, { backgroundColor: colors.moduleIconSurface, borderColor: colors.moduleIconBorder }]}>
            <UniversalIcon ios="folder.badge.person.crop" android="folder-shared" size={28} color={colors.moduleText} />
          </View>
          <ThemedText accessibilityRole="header" style={[styles.title, { color: colors.moduleText }]}>Allow file access</ThemedText>
          <ThemedText style={[styles.body, { color: colors.moduleDescription }]}>
            Versara keeps work on this device. Allow access so Image and Video can show recent files you can open quickly.
          </ThemedText>
          <Pressable accessibilityRole="button" accessibilityState={{ busy }} disabled={busy} onPress={() => { void allow(); }} style={[styles.primary, { backgroundColor: colors.onAccent }]}>
            {busy ? <AppLoader color={colors.moduleEnd} /> : <ThemedText style={[styles.primaryLabel, { color: colors.moduleEnd }]}>Allow access</ThemedText>}
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={skip} style={styles.secondary}>
            <ThemedText style={{ color: colors.moduleDescription, fontWeight: '600' }}>Not now</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  card: {
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    padding: spacing.xxl,
    gap: spacing.md,
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    borderCurve: 'continuous',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.heading },
  body: { ...typography.body },
  primary: {
    minHeight: 48,
    marginTop: spacing.sm,
    borderRadius: radius.sm,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: { ...typography.label },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
