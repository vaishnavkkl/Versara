import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Polyline } from 'react-native-svg';
import { AppBottomSheet } from '@/components/app-bottom-sheet';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { signatureImageUri, type RecentSignature } from './recent-signatures';

const HEIGHT = 100;

export const SignatureThumb = memo(function SignatureThumb({ entry, width, height }: { entry: RecentSignature; width: number; height: number }) {
  if (entry.kind === 'image') return <Image source={{ uri: signatureImageUri(entry) }} contentFit="contain" style={{ width, height }} recyclingKey={entry.id} />;
  const viewWidth = entry.aspect * HEIGHT;
  return <Svg width={width} height={height} viewBox={`-4 -4 ${viewWidth + 8} ${HEIGHT + 8}`} preserveAspectRatio="xMidYMid meet">
    {entry.strokes.map((stroke, index) => <Polyline key={index} fill="none" stroke={stroke.color} strokeOpacity={stroke.opacity ?? 1} strokeLinecap="round" strokeLinejoin="round"
      strokeWidth={Math.max(1.5, stroke.width / entry.pageWidth * viewWidth)} points={stroke.points.map(([x, y]) => `${(x * viewWidth).toFixed(1)},${(y * HEIGHT).toFixed(1)}`).join(' ')} />)}
  </Svg>;
});

/** A recent signature as a compact button: one tap places it on the page. */
export function RecentSignatureButton({ entry, disabled, onPress }: { entry: RecentSignature; disabled: boolean; onPress: (entry: RecentSignature) => void }) {
  const colors = usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel={`Use recent ${entry.kind === 'image' ? 'image' : 'drawn'} signature`} disabled={disabled} onPress={() => onPress(entry)}
    style={({ pressed }) => [styles.button, { backgroundColor: '#FFFFFF', borderColor: colors.separator, opacity: disabled ? .4 : pressed ? .65 : 1 }]}>
    <SignatureThumb entry={entry} width={68} height={36} />
  </Pressable>;
}

export function RecentSignaturesSheet({ visible, signatures, disabled, onClose, onUse, onRemove }: {
  visible: boolean; signatures: RecentSignature[]; disabled: boolean; onClose: () => void; onUse: (entry: RecentSignature) => void; onRemove: (entry: RecentSignature) => void;
}) {
  const colors = usePalette();
  return <AppBottomSheet visible={visible} onClose={onClose} title="Recent signatures" icon={{ ios: 'signature', android: 'draw' }} maxHeight={0.7}>
    {signatures.length ? signatures.map(entry => <View key={entry.id} style={[styles.row, { borderColor: colors.separator }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Use ${entry.kind === 'image' ? 'image' : 'drawn'} signature`} disabled={disabled} onPress={() => { onClose(); onUse(entry); }}
        style={({ pressed }) => [styles.use, { opacity: disabled ? .4 : pressed ? .65 : 1 }]}>
        <View style={[styles.preview, { borderColor: colors.separator }]}><SignatureThumb entry={entry} width={120} height={52} /></View>
        <View style={styles.grow}>
          <ThemedText style={styles.title}>{entry.kind === 'image' ? entry.backgroundRemoved ? 'Image, background removed' : 'Image' : 'Drawn'}</ThemedText>
          <ThemedText style={{ color: colors.secondaryLabel, fontSize: 12 }}>Tap to add to this page</ThemedText>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Remove from recent signatures" hitSlop={6} disabled={disabled} onPress={() => onRemove(entry)} style={styles.remove}>
        <UniversalIcon ios="trash" android="delete-outline" size={20} color={colors.destructive} />
      </Pressable>
    </View>) : <ThemedText style={{ color: colors.secondaryLabel, textAlign: 'center', padding: 16 }}>Signatures you save in a PDF appear here.</ThemedText>}
  </AppBottomSheet>;
}

const styles = StyleSheet.create({
  // Signatures are dark ink, so previews always sit on white paper.
  button: { minHeight: 48, paddingHorizontal: 6, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  use: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  preview: { backgroundColor: '#FFFFFF', borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 4 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 15, fontWeight: '600' },
  remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
