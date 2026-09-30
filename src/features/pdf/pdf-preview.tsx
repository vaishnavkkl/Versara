import { type ReactNode, useState } from 'react';
import { Stack } from 'expo-router';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { toast } from '@/components/toast';
import { usePalette } from '@/theme/colors';
import NativeEditCanvas from '../../../modules/pdf-engine/src/PdfEditCanvasView';
import { PdfEditCanvas } from './pdf-edit-canvas';
import { usePdfToolLayout } from './pdf-tool-layout';

export const PDF_PREVIEW_BACKGROUND = '#e8eaf0';
export type PdfPreviewImage = { uri: string; width: number; height: number; pointWidth?: number };

/** Shared page controls for editing, annotations and document previews. Pages are one-based. */
export function PdfPreviewToolbar({ page, count, disabled, onPageChange, children }: {
  page: number; count: number; disabled?: boolean; onPageChange: (page: number) => void; children?: ReactNode;
}) {
  const colors = usePalette();
  const toolLayout = usePdfToolLayout();
  const [landscape, setLandscape] = useState(false);
  const [draft, setDraft] = useState({ page, input: String(page) });
  if (draft.page !== page) setDraft({ page, input: String(page) });
  const input = draft.input;
  const setInput = (value: string) => setDraft({ page, input: value });
  function submit() {
    const requested = input.trim();
    const target = /^\d+$/.test(requested) ? Number(requested) : NaN;
    setInput(String(page));
    if (disabled) return;
    if (!Number.isSafeInteger(target) || target < 1 || target > count) {
      if (requested) toast(`Enter a page from 1 to ${count}.`);
      return;
    }
    if (target !== page) onPageChange(target);
  }
  return <View style={styles.toolbar}>
    {!toolLayout && <Stack.Screen options={{ orientation: landscape ? 'landscape' : 'portrait' }} />}
    <View style={styles.pageControls}>
    <Pressable accessibilityRole="button" accessibilityLabel="Previous page" disabled={disabled || page <= 1} onPress={() => onPageChange(page - 1)} style={[styles.icon, (disabled || page <= 1) && styles.dim]}><UniversalIcon ios="chevron.left" android="chevron-left" size={24} color={colors.systemBlue} /></Pressable>
    <TextInput accessibilityLabel={`Page number, 1 to ${count}`} keyboardType="number-pad" returnKeyType="done" selectTextOnFocus value={input} onChangeText={setInput} editable={!disabled} onSubmitEditing={Keyboard.dismiss} onEndEditing={submit} maxLength={6} style={[styles.pageInput, { color: colors.label, backgroundColor: colors.accentSurface }]} />
    <ThemedText numberOfLines={1}>of {count}</ThemedText>
    <Pressable accessibilityRole="button" accessibilityLabel="Next page" disabled={disabled || page >= count} onPress={() => onPageChange(page + 1)} style={[styles.icon, (disabled || page >= count) && styles.dim]}><UniversalIcon ios="chevron.right" android="chevron-right" size={24} color={colors.systemBlue} /></Pressable>
    </View>
    <View style={styles.actions}>{children}
    {!toolLayout && <Pressable accessibilityRole="button" accessibilityLabel={landscape ? 'Portrait preview' : 'Landscape preview'} onPress={() => setLandscape(value => !value)} style={styles.icon}><UniversalIcon ios="rotate.right" android="screen-rotation" size={22} color={colors.systemBlue} /></Pressable>}
    </View>
  </View>;
}

/** The canvas always gets the remaining height; controls stay outside its viewport. */
export function PdfPreviewStage({ children, hint, status, onFit, actions }: { children: ReactNode; actions?: ReactNode; hint: string; status?: string; onFit?: () => void }) {
  const colors = usePalette();
  return <>
    <View style={styles.viewport}>
      {children}
      {actions && <View pointerEvents="box-none" style={{ position: 'absolute', right: 10, top: 10, maxWidth: '85%', alignItems: 'flex-end', gap: 8 }}>{actions}</View>}
      {onFit && <Pressable accessibilityRole="button" accessibilityLabel="Fit PDF page" onPress={onFit} style={[styles.fit, actions ? { top: undefined, bottom: 10 } : undefined, { backgroundColor: colors.systemBackground, borderColor: colors.separator }]}><UniversalIcon ios="arrow.down.right.and.arrow.up.left" android="fit-screen" size={21} color={colors.systemBlue} /></Pressable>}
    </View>
    <View style={styles.caption}>
      <ThemedText numberOfLines={2} style={[styles.hint, styles.grow, { color: colors.secondaryLabel }]}>{hint}</ThemedText>
      {!!status && <ThemedText style={[styles.hint, { color: colors.systemBlue }]}>{status}</ThemedText>}
    </View>
  </>;
}

/** Read-only use of the exact native canvas used by Edit PDF, including pinch/pan/double tap. */
export function PdfPagePreview({ image, active = true, preserveViewport = false, hint = 'Pinch to zoom. Drag to move. Double tap to zoom or fit.', rotation = 0 }: { image: PdfPreviewImage; active?: boolean; preserveViewport?: boolean; hint?: string; rotation?: number }) {
  const [fit, setFit] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const angle = ((rotation % 360) + 360) % 360;
  const sideways = angle === 90 || angle === 270;
  const key = `${preserveViewport ? 'live' : image.uri}:${fit}`;
  return <PdfPreviewStage hint={hint} onFit={active && NativeEditCanvas ? () => setFit(value => value + 1) : undefined}>
    <View style={styles.grow} onLayout={event => {
      const { width, height } = event.nativeEvent.layout;
      setViewport(current => current.width === width && current.height === height ? current : { width, height });
    }}>
    <View style={sideways ? { position: 'absolute', width: viewport.height, height: viewport.width,
      left: (viewport.width - viewport.height) / 2, top: (viewport.height - viewport.width) / 2,
      transform: [{ rotate: `${angle}deg` }] } : [styles.grow, { transform: [{ rotate: `${angle}deg` }] }]}>
    {active && (!sideways || viewport.width > 0) && (NativeEditCanvas
      ? <NativeEditCanvas key={key} style={styles.grow} source={image.uri} pageLayout={JSON.stringify({ width: image.width, height: image.height, pointWidth: image.pointWidth ?? 0 })} objects="[]" selectedId={-1} adding={false} disabled={false} placement="" textBox={'{"visible":false}'} focus="" />
      : <PdfEditCanvas key={key} uri={image.uri} width={image.width} height={image.height} objects={[]} adding={false} disabled={false} removedIds={[]} placement={null} onSelect={() => {}} onPlace={() => {}} />)}
    </View></View>
  </PdfPreviewStage>;
}

export function PdfPreviewFooter({ children }: { children: ReactNode }) {
  const colors = usePalette();
  return <View style={[styles.footer, { backgroundColor: colors.systemBackground, borderColor: colors.separator }]}>{children}</View>;
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 4, paddingHorizontal: 4, paddingVertical: 4, minHeight: 52 },
  pageControls: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 4, flexGrow: 1 },
  pageInput: { width: 44, minHeight: 44, paddingHorizontal: 4, textAlign: 'center', borderRadius: 12, fontSize: 16 },
  icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0 }, dim: { opacity: 0.35 },
  viewport: { flex: 1, minHeight: 120, overflow: 'hidden', backgroundColor: PDF_PREVIEW_BACKGROUND },
  fit: { position: 'absolute', right: 10, top: 10, width: 44, height: 44, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  caption: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
  hint: { fontSize: 12, lineHeight: 16 },
  footer: { padding: 8, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
