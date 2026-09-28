import { type ReactNode, useState } from 'react';
import { Stack } from 'expo-router';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import NativeEditCanvas from '../../../modules/pdf-engine/src/PdfEditCanvasView';
import { PdfEditCanvas } from './pdf-edit-canvas';

export const PDF_PREVIEW_BACKGROUND = '#e8eaf0';
export type PdfPreviewImage = { uri: string; width: number; height: number; pointWidth?: number };

/** Shared page controls for editing, annotations and document previews. Pages are one-based. */
export function PdfPreviewToolbar({ page, count, disabled, onPageChange, children }: {
  page: number; count: number; disabled?: boolean; onPageChange: (page: number) => void; children?: ReactNode;
}) {
  const colors = usePalette();
  const [landscape, setLandscape] = useState(false);
  const [draft, setDraft] = useState({ page, input: String(page) });
  if (draft.page !== page) setDraft({ page, input: String(page) });
  const input = draft.input;
  const setInput = (value: string) => setDraft({ page, input: value });
  function submit() {
    const target = /^\d+$/.test(input) ? Number(input) : NaN;
    setInput(String(page));
    if (!disabled && Number.isInteger(target) && target >= 1 && target <= count && target !== page) onPageChange(target);
  }
  return <View style={styles.toolbar}>
    <Stack.Screen options={{ orientation: landscape ? 'landscape' : 'portrait' }} />
    <Pressable accessibilityRole="button" accessibilityLabel="Previous page" disabled={disabled || page <= 1} onPress={() => onPageChange(page - 1)} style={[styles.icon, (disabled || page <= 1) && styles.dim]}><UniversalIcon ios="chevron.left" android="chevron-left" size={24} color={colors.systemBlue} /></Pressable>
    <TextInput accessibilityLabel={`Page number, ${count} pages`} keyboardType="number-pad" returnKeyType="done" selectTextOnFocus value={input} onChangeText={setInput} editable={!disabled} onSubmitEditing={submit} onEndEditing={submit} maxLength={5} style={[styles.pageInput, { color: colors.label, backgroundColor: colors.accentSurface }]} />
    <ThemedText numberOfLines={1}>of {count}</ThemedText>
    <Pressable accessibilityRole="button" accessibilityLabel="Next page" disabled={disabled || page >= count} onPress={() => onPageChange(page + 1)} style={[styles.icon, (disabled || page >= count) && styles.dim]}><UniversalIcon ios="chevron.right" android="chevron-right" size={24} color={colors.systemBlue} /></Pressable>
    <View style={styles.grow} />{children}
    <Pressable accessibilityRole="button" accessibilityLabel={landscape ? 'Portrait preview' : 'Landscape preview'} onPress={() => setLandscape(value => !value)} style={styles.icon}><UniversalIcon ios="rotate.right" android="screen-rotation" size={22} color={colors.systemBlue} /></Pressable>
  </View>;
}

/** The canvas always gets the remaining height; controls stay outside its viewport. */
export function PdfPreviewStage({ children, hint, status, onFit }: { children: ReactNode; hint: string; status?: string; onFit?: () => void }) {
  const colors = usePalette();
  return <>
    <View style={styles.viewport}>
      {children}
      {onFit && <Pressable accessibilityRole="button" accessibilityLabel="Fit PDF page" onPress={onFit} style={[styles.fit, { backgroundColor: colors.systemBackground, borderColor: colors.separator }]}><UniversalIcon ios="arrow.down.right.and.arrow.up.left" android="fit-screen" size={21} color={colors.systemBlue} /></Pressable>}
    </View>
    <View style={styles.caption}>
      <ThemedText numberOfLines={2} style={[styles.hint, styles.grow, { color: colors.secondaryLabel }]}>{hint}</ThemedText>
      {!!status && <ThemedText style={[styles.hint, { color: colors.systemBlue }]}>{status}</ThemedText>}
    </View>
  </>;
}

/** Read-only use of the exact native canvas used by Edit PDF, including pinch/pan/double tap. */
export function PdfPagePreview({ image, active = true, preserveViewport = false, hint = 'Pinch to zoom. Drag to move. Double tap to zoom or fit.' }: { image: PdfPreviewImage; active?: boolean; preserveViewport?: boolean; hint?: string }) {
  const [fit, setFit] = useState(0);
  const key = `${preserveViewport ? 'live' : image.uri}:${fit}`;
  return <PdfPreviewStage hint={hint} onFit={active && NativeEditCanvas ? () => setFit(value => value + 1) : undefined}>
    {active && (NativeEditCanvas
      ? <NativeEditCanvas key={key} style={styles.grow} source={image.uri} pageLayout={JSON.stringify({ width: image.width, height: image.height, pointWidth: image.pointWidth ?? 0 })} objects="[]" selectedId={-1} adding={false} disabled={false} placement="" textBox={'{"visible":false}'} focus="" />
      : <PdfEditCanvas key={key} uri={image.uri} width={image.width} height={image.height} objects={[]} adding={false} disabled={false} removedIds={[]} placement={null} onSelect={() => {}} onPlace={() => {}} />)}
  </PdfPreviewStage>;
}

export function PdfPreviewFooter({ children }: { children: ReactNode }) {
  const colors = usePalette();
  return <View style={[styles.footer, { backgroundColor: colors.systemBackground, borderColor: colors.separator }]}>{children}</View>;
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, minHeight: 52 },
  pageInput: { width: 54, minHeight: 44, paddingHorizontal: 4, textAlign: 'center', borderRadius: 12, fontSize: 16 },
  icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0 }, dim: { opacity: 0.35 },
  viewport: { flex: 1, minHeight: 120, overflow: 'hidden', backgroundColor: PDF_PREVIEW_BACKGROUND },
  fit: { position: 'absolute', right: 10, top: 10, width: 44, height: 44, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  caption: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
  hint: { fontSize: 12, lineHeight: 16 },
  footer: { padding: 8, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
