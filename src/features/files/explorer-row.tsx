import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { gradient } from '@/theme/dashboard';
import type { ExplorerEntry } from '../../../modules/file-engine';
import { formatSize } from './file-storage';
import { formatDate, KIND_GLYPHS } from './explorer';

type Props = { entry: ExplorerEntry; onPress: (entry: ExplorerEntry) => void; showFolder?: boolean };

export const ExplorerRow = memo(function ExplorerRow({ entry, onPress, showFolder }: Props) {
  const colors = usePalette();
  const glyph = KIND_GLYPHS[entry.kind] ?? KIND_GLYPHS.other;
  const detail = entry.directory
    ? entry.count >= 0 ? `${entry.count} ${entry.count === 1 ? 'item' : 'items'}` : 'Folder'
    : `${formatSize(entry.size)} · ${formatDate(entry.modified)}`;
  const folder = showFolder ? entry.path.slice(0, entry.path.length - entry.name.length - 1).split('/').pop() : undefined;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${entry.directory ? 'Folder' : 'File'} ${entry.name}. ${detail}`} onPress={() => onPress(entry)} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
      <View style={[styles.icon, gradient(`linear-gradient(145deg, ${glyph.tint[1]} 0%, ${glyph.tint[0]} 100%)`), { backgroundColor: glyph.tint[0] }]}>
        <UniversalIcon ios={glyph.ios} android={glyph.android} size={22} color="#FFFFFF" />
      </View>
      <View style={styles.text}>
        <ThemedText numberOfLines={1} style={[styles.name, { color: colors.label }]}>{entry.name}</ThemedText>
        <ThemedText numberOfLines={1} style={[styles.detail, { color: colors.secondaryLabel }]}>{folder ? `${folder} · ${detail}` : detail}</ThemedText>
      </View>
      {entry.directory && <UniversalIcon ios="chevron.right" android="chevron-right" size={18} color={colors.muted} />}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, minHeight: 64 },
  icon: { width: 44, height: 44, borderRadius: 13, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  detail: { fontSize: 12, lineHeight: 16 },
});
