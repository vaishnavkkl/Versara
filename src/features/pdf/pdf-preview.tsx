import { type ReactNode, useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { Keyboard, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { toast } from '@/components/toast';
import { HeaderHistorySlot } from '@/components/header-history';
import { FitSlotButton, usePublishFit } from '@/components/fit-slot';
import { ToolActionRow, ToolRowButton } from '@/components/tool-action-row';
import { usePalette } from '@/theme/colors';
import NativeEditCanvas from '../../../modules/pdf-engine/src/PdfEditCanvasView';
import { PdfEditCanvas } from './pdf-edit-canvas';
import { usePdfToolLayout } from './pdf-tool-layout';
import { PdfPageStrip } from './pdf-page-strip';
import { usePdfScreenActive } from './use-pdf-screen-active';

export const PDF_PREVIEW_BACKGROUND = '#e8eaf0';
export type PdfPreviewImage = { uri: string; width: number; height: number; pointWidth?: number };

/**
 * Shared page row for editing, annotations and document previews. Pages are one-based.
 * Undo/redo (`history`) and `leading` sit on the left, page navigation is centred and `children` sit on the right.
 * `below` holds wider tool menus on a second line.
 */
export function PdfPreviewToolbar({ page, count, disabled, onPageChange, children, history = false, leading, below, rotate = true, orientation }: {
  page: number; count: number; disabled?: boolean; onPageChange: (page: number) => void; children?: ReactNode;
  history?: boolean; leading?: ReactNode; below?: ReactNode; rotate?: boolean;
  /** Screens that own their orientation (the PDF reader) pass it here instead of the toolbar setting it. */
  orientation?: { landscape: boolean; onToggle: () => void };
}) {
  const colors = usePalette();
  const sideways = useSideways();
  const toolLayout = usePdfToolLayout();
  const registerPageRow = toolLayout?.registerPageRow;
  useEffect(() => registerPageRow?.(), [registerPageRow]);
  const [ownLandscape, setOwnLandscape] = useState(false);
  const landscape = orientation?.landscape ?? toolLayout?.landscape ?? ownLandscape;
  const toggleLandscape = () => { Keyboard.dismiss(); if (orientation) orientation.onToggle(); else (toolLayout?.setLandscape ?? setOwnLandscape)(value => !value); };
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
  // Beside undo/redo, Fit would wrap the page row onto a second line; a tool menu line has room at its start.
  const crowded = !sideways && (history || !!leading);
  const fitBelow = crowded && !!below;
  const fitRight = crowded && !below;
  return <>
    {!toolLayout && !orientation && <Stack.Screen options={{ orientation: landscape ? 'landscape' : 'portrait' }} />}
    <ToolActionRow vertical={sideways}
      left={<>{!crowded && <FitSlotButton />}{history && <HeaderHistorySlot />}{leading}</>}
      center={<>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous page" disabled={disabled || page <= 1} onPress={() => onPageChange(page - 1)} style={[styles.icon, (disabled || page <= 1) && styles.dim]}><UniversalIcon ios={sideways ? 'chevron.up' : 'chevron.left'} android={sideways ? 'keyboard-arrow-up' : 'chevron-left'} size={24} color={colors.systemBlue} /></Pressable>
        <TextInput accessibilityLabel={`Page number, 1 to ${count}`} keyboardType="number-pad" returnKeyType="done" selectTextOnFocus value={input} onChangeText={setInput} editable={!disabled} onSubmitEditing={Keyboard.dismiss} onEndEditing={submit} maxLength={6} style={[styles.pageInput, { color: colors.label, backgroundColor: colors.accentSurface }]} />
        <ThemedText numberOfLines={1} style={styles.pageCount}>of {count}</ThemedText>
        <Pressable accessibilityRole="button" accessibilityLabel="Next page" disabled={disabled || page >= count} onPress={() => onPageChange(page + 1)} style={[styles.icon, (disabled || page >= count) && styles.dim]}><UniversalIcon ios={sideways ? 'chevron.down' : 'chevron.right'} android={sideways ? 'keyboard-arrow-down' : 'chevron-right'} size={24} color={colors.systemBlue} /></Pressable>
      </>}
      right={<>{fitRight && <FitSlotButton />}{children}{rotate && <ToolRowButton label={landscape ? 'Switch to portrait' : 'Switch to landscape'} selected={landscape} icon={{ ios: 'rotate.right', android: 'screen-rotation' }} onPress={toggleLandscape} />}</>}
      below={fitBelow ? <><FitSlotButton /><View style={styles.grow} />{below}</> : below} />
  </>;
}

const useSideways = () => { const { width, height } = useWindowDimensions(); return width > height; };

export type PdfPageList = { uri: string; count: number; page: number; onSelect: (page: number) => void };

/**
 * The page row sits above the preview in portrait and becomes a left rail beside it in landscape, like the PDF preview screen.
 * With `pages`, landscape also lists page thumbnails on both sides: odd pages left, even pages right (zero-based pages).
 */
export function PdfPreviewBody({ toolbar, children, pages }: { toolbar: ReactNode; children: ReactNode; pages?: PdfPageList | null }) {
  const sideways = useSideways();
  const active = usePdfScreenActive();
  if (!sideways) return <>{toolbar}{children}</>;
  const list = (parity: 0 | 1) => pages && active && pages.count > parity
    ? <PdfPageStrip vertical parity={parity} uri={pages.uri} count={pages.count} page={pages.page} onSelect={pages.onSelect} /> : null;
  return <View style={styles.sideways}>{toolbar}{list(0)}<View style={styles.grow}>{children}</View>{list(1)}</View>;
}

/** The canvas always gets the remaining height; controls stay outside its viewport. */
export function PdfPreviewStage({ children, hint, status, onFit: fitPage, actions }: { children: ReactNode; actions?: ReactNode; hint: string; status?: string; onFit?: () => void }) {
  const colors = usePalette();
  const fitInRow = usePublishFit(fitPage);
  const onFit = fitInRow ? undefined : fitPage;
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
  pageInput: { width: 44, minHeight: 40, paddingHorizontal: 4, paddingVertical: 0, textAlign: 'center', borderRadius: 12, fontSize: 16 },
  pageCount: { paddingHorizontal: 2 },
  icon: { minWidth: 40, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0 }, dim: { opacity: 0.35 }, sideways: { flex: 1, flexDirection: 'row' },
  viewport: { flex: 1, minHeight: 120, overflow: 'hidden', backgroundColor: PDF_PREVIEW_BACKGROUND },
  fit: { position: 'absolute', right: 10, top: 10, width: 44, height: 44, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  caption: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
  hint: { fontSize: 12, lineHeight: 16 },
  footer: { padding: 8, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
