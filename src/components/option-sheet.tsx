import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { AppBottomSheet } from './app-bottom-sheet';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';
import type { OptionIcon } from '@/theme/editor-icons';

/**
 * Bottom sheet for tool options. It overlays the preview instead of shrinking it.
 * The sheet sizes to its content up to a cap, and the options scroll inside it.
 */
export function OptionSheet({ title, icon, isPresented, onClose, expandable = false, dim = true, children }: {
  title: string; icon?: OptionIcon; isPresented: boolean; onClose: () => void; expandable?: boolean; dim?: boolean; children: ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  return <AppBottomSheet visible={isPresented} onClose={onClose} title={title} icon={icon} dim={dim} maxHeight={expandable || width > height ? 0.92 : 0.7}>
    {children}
  </AppBottomSheet>;
}

/** A titled, rounded group of related options inside a sheet or panel. */
export function OptionCard({ title, icon, trailing, children }: { title?: string; icon?: OptionIcon; trailing?: ReactNode; children: ReactNode }) {
  const colors = usePalette();
  return <View style={[styles.card, { backgroundColor: colors.catalogSurface, borderColor: colors.catalogBorder }]}>
    {(title || trailing) && <View style={styles.cardHeader}>
      {icon && <UniversalIcon {...icon} size={18} color={colors.secondaryLabel} />}
      {title && <ThemedText style={[styles.cardTitle, { color: colors.secondaryLabel }]}>{title}</ThemedText>}
      {trailing}
    </View>}
    {children}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderCurve: 'continuous', paddingHorizontal: 10, paddingVertical: 12, gap: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1, fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
});
