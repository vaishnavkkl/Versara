import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { HelpPressable as Pressable } from '@/components/help-pressable';
import { FileThumbnail } from '@/components/file-thumbnail';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';

/** The same portrait source card for ordered PDFs and image-to-PDF inputs. */
export const PdfSourceCard = memo(function PdfSourceCard({ uri, name, label, detail, kind, active, disabled, onPreview, onMove, onRemove, canMoveBack, canMoveForward, fullWidth = false }: {
  uri: string; name: string; label: string; detail: string; kind: 'pdf' | 'image'; active: boolean; disabled: boolean;
  onPreview: () => void; onMove: (direction: number) => void; onRemove: () => void; canMoveBack: boolean; canMoveForward: boolean;
  fullWidth?: boolean;
}) {
  const colors = usePalette();
  return <View style={[styles.card, fullWidth && { width: '100%' }, { backgroundColor: colors.accentSurface, borderColor: colors.separator }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Preview ${name}`} disabled={disabled} onPress={onPreview} style={styles.preview}>
      <View style={styles.thumb}><FileThumbnail uri={uri} kind={kind} active={active} /></View>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <ThemedText numberOfLines={2} style={styles.name}>{name}</ThemedText>
      <ThemedText numberOfLines={1} style={[styles.detail, { color: colors.secondaryLabel }]}>{detail}</ThemedText>
    </Pressable>
    <View style={styles.actions}>
      {([-1, 1] as const).map(direction => {
        const off = disabled || !(direction === -1 ? canMoveBack : canMoveForward);
        return <Pressable key={direction} accessibilityRole="button" accessibilityLabel={`Move ${name} ${direction < 0 ? 'earlier' : 'later'}`} disabled={off} onPress={() => onMove(direction)} style={[styles.icon, off && styles.dim]}>
          <UniversalIcon ios={direction < 0 ? 'chevron.left' : 'chevron.right'} android={direction < 0 ? 'chevron-left' : 'chevron-right'} size={22} color={colors.systemBlue} />
        </Pressable>;
      })}
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name}`} disabled={disabled} onPress={onRemove} style={[styles.icon, disabled && styles.dim]}><UniversalIcon ios="xmark" android="close" size={22} color={colors.systemBlue} /></Pressable>
    </View>
  </View>;
});
const styles = StyleSheet.create({
  card: { width: '48%', borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: 'hidden', marginBottom: 12 },
  preview: { padding: 8, gap: 4 }, thumb: { width: '100%', aspectRatio: 3 / 4, minHeight: 88 },
  label: { fontSize: 14, fontWeight: '600' }, name: { fontSize: 14, lineHeight: 18, minHeight: 36 }, detail: { fontSize: 12 },
  actions: { flexDirection: 'row', justifyContent: 'space-around' }, icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, dim: { opacity: .3 },
});
