import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/theme/colors';

/** A failed recovery does not block navigation or extend the splash screen. */
export function SaveRecoveryNotice({ message, busy, onRetry, onDismiss }: { message: string; busy: boolean; onRetry: () => void; onDismiss: () => void }) {
  const colors = usePalette();
  return <SafeAreaView edges={['bottom']} pointerEvents="box-none" style={styles.position}>
    <View style={[styles.card, { backgroundColor: colors.secondarySystemBackground, borderColor: colors.separator }]}>
      <ThemedText accessibilityRole="alert" style={styles.message}>{message}</ThemedText>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss save recovery notice" disabled={busy} onPress={onDismiss} style={styles.button}><ThemedText>Later</ThemedText></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Retry interrupted save recovery" accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={onRetry} style={styles.button}><ThemedText style={{ color: colors.accent, fontWeight: '600' }}>{busy ? 'Recovering…' : 'Retry'}</ThemedText></Pressable>
      </View>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  position: { position: 'absolute', left: 12, right: 12, bottom: 8, alignItems: 'center' },
  card: { width: '100%', maxWidth: 520, borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, paddingTop: 12 },
  message: { fontSize: 14 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  button: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
});
