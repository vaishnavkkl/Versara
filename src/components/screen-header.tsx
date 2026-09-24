import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import { spacing as s, typography as t } from '@/theme/dashboard';

type Props = { title: string; onBack: () => void; backLabel?: string; variant?: 'back' | 'close'; children?: ReactNode };

/** Screens go back from the left; file previews and sheets close from the right. */
export function ScreenHeader({ title, onBack, backLabel, variant = 'back', children }: Props) {
  const colors = usePalette();
  const close = variant === 'close';
  const button = <Pressable accessibilityRole="button" accessibilityLabel={backLabel ?? (close ? 'Close preview' : 'Go back')} onPress={onBack} hitSlop={4}
    style={({ pressed }) => [styles.back, close && { backgroundColor: colors.accentSurface, borderRadius: 22 }, { opacity: pressed ? 0.6 : 1 }]}>
    <UniversalIcon ios={close ? 'xmark' : 'chevron.left'} android={close ? 'close' : 'arrow-back'} size={22} color={colors.systemBlue} />
  </Pressable>;
  return <View style={[styles.header, close && styles.closeHeader, { borderColor: colors.separator }]}>
    {close ? children ?? <View style={styles.back} /> : button}
    <ThemedText accessibilityRole="header" numberOfLines={1} style={styles.title}>{title}</ThemedText>
    {close ? button : children ?? <View style={styles.back} />}
  </View>;
}

const styles = StyleSheet.create({
  header: { minHeight: 52, paddingLeft: s.xs, paddingRight: s.md, flexDirection: 'row', alignItems: 'center', gap: s.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  closeHeader: { paddingLeft: s.md, paddingRight: s.sm },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, ...t.label, fontSize: 17, textAlign: 'center' },
});
