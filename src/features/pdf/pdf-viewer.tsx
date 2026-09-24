import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { AppLoader } from '@/components/app-loader';
import { router } from 'expo-router';
import { File } from 'expo-file-system';
import { PdfEngineView, isPdfEngineAvailable } from '../../../modules/pdf-engine';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { showDialog } from '@/components/app-dialog';
import { toast } from '@/components/toast';
import { useAppearance, usePalette } from '@/theme/colors';
import { getGradients, radius, spacing as s, typography as t } from '@/theme/dashboard';
import { copyForExport, prunePdfCache, removeViewerFile } from './pdf-cache';
import { importRecentFile, rememberFile } from '../files/recent-files';
import { ToolRail, type RailTool } from '@/components/tool-rail';
import { PdfPageStrip } from './pdf-page-strip';
import { saveToDevice } from '../files/save-file';

import { createPdfToolForDocument, discardPdfToolSession, implementedPdfTools, type PdfTool } from './pdf-tool-session';
import { PDF_SECTIONS } from '@/constants/pdf-methods';
import { formatSize } from '../files/file-storage';
import { useScreenActive } from '@/hooks/use-screen-active';

type Document = { uri: string; name: string };

const SECTION_ORDER = ['Edit & annotate', 'Organize pages', 'Convert & optimize'];
const allPdfTools = PDF_SECTIONS.filter(section => section.title !== 'Read & explore')
  .sort((a, b) => SECTION_ORDER.indexOf(a.title) - SECTION_ORDER.indexOf(b.title))
  .flatMap(section => [...section.tools]);
const editTools: RailTool[] = allPdfTools.filter(tool => implementedPdfTools.has(tool.id))
  .map(tool => ({ id: tool.id, title: tool.title.replace(/ PDFs?$/, ''), ios: tool.ios, android: tool.android }));
const fileTools: RailTool[] = [
  { id: 'save', title: 'Save to device', ios: 'square.and.arrow.down', android: 'save-alt' },
  { id: 'share', title: 'Share', ios: 'square.and.arrow.up', android: 'share' },
  { id: 'info', title: 'Details', ios: 'info.circle', android: 'info-outline' },
  { id: 'open', title: 'Open PDF', ios: 'folder', android: 'folder-open' },
];
const upcomingTools: RailTool[] = allPdfTools.filter(tool => !implementedPdfTools.has(tool.id))
  .map(tool => ({ id: tool.id, title: tool.title.replace(/ PDFs?$/, ''), ios: tool.ios, android: tool.android, soon: true }));
export function PdfViewer({ initialDocument, initialPage = 0, onFocusChange }: { initialDocument?: Document; initialPage?: number; onFocusChange?: (focused: boolean) => void } = {}) {
  const colors = usePalette();
  const screenActive = useScreenActive();
  const mode = useAppearance(state => state.mode);
  const [document, setDocument] = useState<Document | null>(initialDocument ?? null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [pageInput, setPageInput] = useState(String(initialPage + 1));
  const [vertical, setVertical] = useState(true);
  const [thumbnails, setThumbnails] = useState(true);
  const [stripReady, setStripReady] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pageRequest, setPageRequest] = useState({ value: initialPage, revision: 0 });
  const [zoomRequest, setZoomRequest] = useState({ value: 1, revision: 0 });
  const [loading, setLoading] = useState(!!initialDocument);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('Preparing PDF...');
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const mounted = useRef(true);
  const ownedFile = useRef<string | null>(null);
  const actionLock = useRef(false);
  useEffect(() => { if (document) void rememberFile(document, 'pdf').catch(() => { /* Temporary tool inputs are not kept in Recents. */ }); }, [document]);
  useEffect(() => { onFocusChange?.(focused); }, [focused, onFocusChange]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => { if (!mounted.current && !actionLock.current && ownedFile.current) removeViewerFile(ownedFile.current); });
    };
  }, []);

  // Thumbnails start once the first pages are on screen so opening stays smooth.
  useEffect(() => {
    const timer = setTimeout(() => setStripReady(!loading), loading ? 0 : 350);
    return () => clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(prunePdfCache, 1500);
    return () => clearTimeout(timer);
  }, [loading]);

  async function chooseFile() {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusyLabel('Opening files...');
    setBusy(true);
    setActionError(null);
    try {
      const asset = await importRecentFile('pdf');
      if (!asset || !mounted.current) return;
      const uri = asset.uri;
      const previous = ownedFile.current;
      ownedFile.current = null;
      setPageCount(0);
      setPage(0);
      setPageRequest(current => ({ value: 0, revision: current.revision + 1 }));
      setPageInput('1');
      requestZoom(1);
      setError(null);
      setLoading(true);
      setDocument({ uri, name: asset.name });
      if (previous) removeViewerFile(previous);
    } catch {
      if (mounted.current) setActionError('The PDF could not be opened. Check that it is available on this device and try again.');
    } finally {
      actionLock.current = false;
      if (mounted.current) setBusy(false);
      else if (ownedFile.current) removeViewerFile(ownedFile.current);
    }
  }

  async function saveDocument() {
    if (!document || actionLock.current) return;
    actionLock.current = true; setBusyLabel('Saving to your device...'); setBusy(true); setActionError(null);
    try {
      const name = /\.pdf$/i.test(document.name) ? document.name : document.name + '.pdf';
      const saved = await saveToDevice(document.uri, name, 'application/pdf');
      if (mounted.current) showDialog('PDF saved', `${saved.name}\nSaved to ${saved.location}`, undefined, { ios: 'checkmark.circle', android: 'check-circle' });
    } catch (cause) {
      if (mounted.current) setActionError((cause as Error).message || 'Could not save this PDF. Please try again.');
    } finally {
      actionLock.current = false;
      if (mounted.current) setBusy(false);
      else if (ownedFile.current) removeViewerFile(ownedFile.current);
    }
  }

  async function exportDocument() {
    if (!document || actionLock.current) return;
    actionLock.current = true;
    setBusyLabel('Preparing your copy...');
    toast('Preparing your copy…');
    setBusy(true);
    setActionError(null);
    try {
      const uri = await copyForExport(document.uri, document.name);
      if (!mounted.current) return;
      const Sharing = await import('expo-sharing');
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing unavailable');
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Save or share PDF' });
    } catch (cause) {
      const code = (cause as { code?: string })?.code ?? '';
      if (mounted.current && !/cancel/i.test(code)) setActionError('Could not save this PDF. Please try again.');
    } finally {
      actionLock.current = false;
      if (mounted.current) setBusy(false);
      else if (ownedFile.current) removeViewerFile(ownedFile.current);
    }
  }

  function goToPage(next: number) {
    const target = Math.max(0, Math.min(pageCount - 1, next));
    if (target !== page) { setPage(target); setPageRequest(current => ({ value: target, revision: current.revision + 1 })); requestZoom(1); }
    setPageInput(String(target + 1));
  }

  function requestZoom(value: number) {
    const next = Math.max(1, Math.min(5, value));
    setZoomRequest(current => ({ value: next, revision: current.revision + 1 }));
  }

  function performOption(id: string) {
    if (actionLock.current) return;
    Keyboard.dismiss();
    if (id === 'open') { void chooseFile(); return; }
    if (id === 'save') { void saveDocument(); return; }
    if (id === 'share') { void exportDocument(); return; }
    if (id === 'thumbnails') { setThumbnails(value => !value); return; }
    if (id === 'fit') { requestZoom(1); return; }
    if (id === 'focus') { setFocused(true); return; }
    if (id === 'scroll') { setVertical(value => !value); setPageRequest(current => ({ value: page, revision: current.revision + 1 })); requestZoom(1); return; }
    if (id === 'info' && document) {
      let size = '';
      try { size = '\n' + formatSize(new File(document.uri).size); } catch { /* Page details remain available. */ }
      showDialog('Document details', `${document.name}\n${pageCount} ${pageCount === 1 ? 'page' : 'pages'}${size}`, undefined, { ios: 'doc.text', android: 'description' });
      return;
    }
    if (implementedPdfTools.has(id)) void openDocumentTool(id as PdfTool);
  }

  async function openDocumentTool(tool: PdfTool) {
    if (!document || actionLock.current) return;
    const method = PDF_SECTIONS.flatMap(section => [...section.tools]).find(item => item.id === tool);
    if (!method) return;
    actionLock.current = true; setBusy(true); setBusyLabel(`Opening ${method.title}...`); setActionError(null);
    let session: string | null = null;
    try {
      session = await createPdfToolForDocument(tool, method.title, document, page);
      if (!session) return;
      if (!mounted.current) { discardPdfToolSession(session); return; }
      router.push({ pathname: '/pdf-tool', params: { session } });
    } catch (cause) {
      if (session) discardPdfToolSession(session);
      if (mounted.current) setActionError((cause as Error).message || 'Could not open this tool. Please try again.');
    } finally {
      actionLock.current = false;
      if (mounted.current) setBusy(false);
      else if (ownedFile.current) removeViewerFile(ownedFile.current);
    }
  }

  const ready = !!document && pageCount > 0 && !error;
  const tools: RailTool[] = [
    { id: 'scroll', title: vertical ? 'Single page' : 'Scroll', ios: vertical ? 'doc' : 'arrow.up.arrow.down', android: vertical ? 'crop-portrait' : 'swap-vert', highlighted: true, accessibilityLabel: vertical ? 'Switch to one page at a time' : 'Switch to vertical scrolling' },
    { id: 'fit', title: 'Fit page', ios: 'arrow.down.right.and.arrow.up.left', android: 'fit-screen' },
    { id: 'thumbnails', title: thumbnails ? 'Hide pages' : 'Pages', ios: 'square.grid.2x2', android: 'view-carousel', accessibilityLabel: thumbnails ? 'Hide page thumbnails' : 'Show page thumbnails' },
    { id: 'focus', title: 'Focus', ios: 'arrow.up.left.and.arrow.down.right', android: 'fullscreen' },
    ...editTools, ...fileTools, ...upcomingTools,
  ];
  const strip = ready && !focused && thumbnails && stripReady && screenActive && document ? <PdfPageStrip uri={document.uri} count={pageCount} page={page} onSelect={goToPage} /> : null;
  const submitPage = () => goToPage((Number.parseInt(pageInput, 10) || 1) - 1);
  return (
    <View style={styles.screen}>
      {!isPdfEngineAvailable ? (
        <View style={styles.empty}>
          <UniversalIcon ios="doc.richtext" android="picture-as-pdf" size={40} color={colors.systemBlue} />
          <ThemedText style={styles.heading}>Native PDF viewer</ThemedText>
          <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{Platform.OS === 'web' ? 'Open this tool in the Android or iOS app.' : 'Install a development build containing the PDF engine to open documents.'}</ThemedText>
        </View>
      ) : (
        <>
          {actionError && <ThemedText accessibilityRole="alert" style={[styles.message, { color: colors.label, backgroundColor: colors.accentSurface }]}>{actionError}</ThemedText>}
          {ready && !focused && <View style={[styles.pageBar, { borderColor: colors.separator }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous page" disabled={page === 0 || loading} onPress={() => goToPage(page - 1)} style={[styles.iconButton, (page === 0 || loading) && styles.disabled]}><UniversalIcon ios="chevron.left" android="chevron-left" size={22} color={colors.systemBlue} /></Pressable>
            <TextInput accessibilityLabel="Page number" value={pageInput} onChangeText={setPageInput} keyboardType="number-pad" returnKeyType="go" selectTextOnFocus onSubmitEditing={submitPage} onEndEditing={submitPage} style={[styles.pageInput, { color: colors.label, backgroundColor: colors.accentSurface }]} />
            <ThemedText style={styles.buttonText}>of {pageCount}</ThemedText>
            <Pressable accessibilityRole="button" accessibilityLabel="Next page" disabled={page >= pageCount - 1 || loading} onPress={() => goToPage(page + 1)} style={[styles.iconButton, (page >= pageCount - 1 || loading) && styles.disabled]}><UniversalIcon ios="chevron.right" android="chevron-right" size={22} color={colors.systemBlue} /></Pressable>
          </View>}
          <View style={[styles.body2, landscape && styles.row]}>
          <View style={[styles.canvas, { backgroundColor: colors.systemBackground }]}>
            {document && !error && screenActive && <PdfEngineView
              key={document.uri}
              uri={document.uri}
              page={page}
              pageRevision={pageRequest.revision}
              vertical={vertical}
              zoom={zoomRequest.value}
              zoomRevision={zoomRequest.revision}
              dark={mode === 'dark'}
              style={styles.nativeView}
              onLoad={({ nativeEvent }) => { setPageCount(nativeEvent.pageCount); setLoading(false); }}
              onPageChange={({ nativeEvent }) => { setPage(nativeEvent.page); setPageInput(String(nativeEvent.page + 1)); setLoading(false); }}
              onZoomChange={() => {}}
              onError={({ nativeEvent }) => { setError(nativeEvent.message); setLoading(false); }}
            />}
            {(busy || (loading && !error)) && <View pointerEvents="none" style={[styles.loading, { backgroundColor: loading || !document || error ? colors.systemBackground : 'transparent' }]}><View style={[styles.loadingCard, { backgroundColor: colors.secondarySystemBackground, borderColor: colors.separator }]}><AppLoader size="large" /><ThemedText accessibilityLiveRegion="polite" style={styles.rowTitle}>{busy ? busyLabel : 'Opening PDF...'}</ThemedText><ThemedText numberOfLines={2} style={[styles.body, { color: colors.secondaryLabel }]}>{document?.name ?? 'Choose a document to continue'}</ThemedText></View></View>}
            {(!document || error) && !busy && <View style={styles.empty}>
              <UniversalIcon ios={error ? 'exclamationmark.triangle' : 'doc.richtext'} android={error ? 'error-outline' : 'picture-as-pdf'} size={40} color={colors.systemBlue} />
              <ThemedText style={styles.heading}>{error ? 'Unable to display PDF' : 'Your documents, on your device'}</ThemedText>
              <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{error ?? 'Choose a PDF, swipe up to read and pinch to zoom. Editing and reading tools appear below.'}</ThemedText>
            </View>}
          </View>
          {!landscape && strip}
          {ready && !focused && <ToolRail tools={tools} disabled={busy || loading} landscape={landscape} onAction={performOption} />}
          </View>
          {landscape && strip}
          {focused && <Pressable accessibilityRole="button" accessibilityLabel="Exit focus view and show controls" onPress={() => setFocused(false)} style={[styles.restore, { backgroundColor: colors.accentSurface }]}><UniversalIcon ios="arrow.down.right.and.arrow.up.left" android="fullscreen-exit" size={22} color={colors.systemBlue} /><ThemedText style={{ color: colors.systemBlue }}>Show controls</ThemedText></Pressable>}
          {(!document || error) && <Pressable accessibilityRole="button" disabled={busy} onPress={chooseFile} style={[styles.openButton, getGradients(colors).module]}><UniversalIcon ios="folder" android="folder-open" size={22} color={colors.moduleText} /><ThemedText style={{ color: colors.moduleText }}>Choose PDF</ThemedText></Pressable>}
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  restore: { position: 'absolute', bottom: 16, alignSelf: 'center', minHeight: 48, paddingHorizontal: 16, borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonText: { ...t.caption },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  message: { ...t.caption, marginHorizontal: s.lg, padding: s.md, borderRadius: radius.sm },
  canvas: { flex: 1, minHeight: 120 },
  nativeView: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: s.lg, padding: s.xxl },
  heading: { ...t.heading, textAlign: 'center' },
  body: { ...t.body, textAlign: 'center' },
  loading: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center' },
  pageBar: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: s.sm, paddingVertical: 4, gap: s.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  body2: { flex: 1 },
  row: { flexDirection: 'row' },
  pageInput: { ...t.body, minWidth: 48, maxWidth: 80, minHeight: 44, textAlign: 'center', borderRadius: radius.sm },
  loadingCard: { maxWidth: 300, padding: 24, margin: 20, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', gap: 12 },
  rowTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  openButton: { minHeight: 48, margin: 16, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  disabled: { opacity: 0.35 },
});
