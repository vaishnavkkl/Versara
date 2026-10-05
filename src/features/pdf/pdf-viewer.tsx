import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { HelpTextInput as TextInput } from '@/components/help-text-input';
import { HelpPressable as Pressable } from '@/components/help-pressable';
import { AppLoader } from '@/components/app-loader';
import { router, Stack, usePathname } from 'expo-router';
import { PdfEngine, PdfEngineView, isPdfEngineAvailable } from '../../../modules/pdf-engine';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { showDialog } from '@/components/app-dialog';
import { toast } from '@/components/toast';
import { useAppearance, usePalette } from '@/theme/colors';
import { getGradients, radius, spacing as s, typography as t } from '@/theme/dashboard';
import { copyForExport, prunePdfCache, removeViewerFile } from './pdf-cache';
import { importRecentFile, rememberFile } from '../files/recent-files';
import { railSections, ToolRail, type RailTool } from '@/components/tool-rail';
import { ToolSurround, ToolSurroundCloseButton } from '@/components/tool-surround';
import { ToolboxSheet } from '@/components/toolbox-sheet';
import { hydrateSearchHistory, useSearchHistory } from '../search/search-history';
import { useToolRing } from '@/hooks/use-tool-ring';
import { PdfPageStrip } from './pdf-page-strip';
import { saveExistingFile } from '../files/save-file';

import { createPdfToolForDocument, discardPdfToolSession, implementedPdfTools, type PdfTool } from './pdf-tool-session';
import { PDF_SECTIONS } from '@/constants/pdf-methods';
import { usePdfScreenActive } from './use-pdf-screen-active';
import { usePdfToolLayout } from './pdf-tool-layout';
import { usePublishHeaderShare } from '@/components/header-share';
import { usePublishHeaderOrientation } from '@/components/header-orientation';
import { ToolRowButton } from '@/components/tool-action-row';
import { PdfPreviewToolbar } from './pdf-preview';
import { usePdfSearch } from './use-pdf-search';

type Document = { uri: string; name: string };

const SECTION_ORDER = ['Quick tools', 'Edit & annotate', 'Organize pages', 'Convert & optimize', 'Protect & inspect'];
const allPdfTools = PDF_SECTIONS.filter(section => section.title !== 'Read & explore')
  .sort((a, b) => SECTION_ORDER.indexOf(a.title) - SECTION_ORDER.indexOf(b.title))
  .flatMap(section => [...section.tools]);
const editTools: RailTool[] = allPdfTools.filter(tool => implementedPdfTools.has(tool.id))
  .map(tool => ({ id: tool.id, title: tool.title, ios: tool.ios, android: tool.android, category: PDF_SECTIONS.find(section => section.tools.some(item => item.id === tool.id))?.title }));
const fileTools: RailTool[] = [
  { id: 'save', title: 'Save', ios: 'square.and.arrow.down', android: 'save' },
  { id: 'share', title: 'Share', ios: 'square.and.arrow.up', android: 'share' },
  { id: 'info', title: 'Details', ios: 'info.circle', android: 'info-outline' },
  { id: 'open', title: 'Open PDF', ios: 'folder', android: 'folder-open' },
];
const upcomingTools: RailTool[] = allPdfTools.filter(tool => !implementedPdfTools.has(tool.id))
  .map(tool => ({ id: tool.id, title: tool.title, ios: tool.ios, android: tool.android, soon: true }));
const DEFAULT_QUICK = ['edit_text', 'ocr', 'remove_text', 'text'];
/** Longer than the native stack's push animation. */
const RELEASE_DELAY_MS = 500;
const SLOW_OPEN_MS = 350;
export function PdfViewer({ initialDocument, initialPage = 0, onFocusChange }: { initialDocument?: Document; initialPage?: number; onFocusChange?: (focused: boolean) => void } = {}) {
  const colors = usePalette();
  const screenActive = usePdfScreenActive();
  const pathname = usePathname();
  const mode = useAppearance(state => state.mode);
  const [document, setDocument] = useState<Document | null>(initialDocument ?? null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [vertical, setVertical] = useState(true);
  const [thumbnails, setThumbnails] = useState(true);
  const [stripReady, setStripReady] = useState(false);
  const [focused, setFocused] = useState(false);
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const recentTools = useSearchHistory(state => state.tools);
  useEffect(hydrateSearchHistory, []);
  // The bottom bar shows the PDF tools used most recently, filled up with the usual quick tools.
  const quickIds = [...new Set([...recentTools.filter(key => key.startsWith('PDF:')).map(key => key.slice(4)), ...DEFAULT_QUICK])]
    .filter(id => editTools.some(tool => tool.id === id)).slice(0, 4);
  const [pageRequest, setPageRequest] = useState({ value: initialPage, revision: 0 });
  const [zoomRequest, setZoomRequest] = useState({ value: 1, revision: 0 });
  const [loading, setLoading] = useState(!!initialDocument);
  const [busy, setBusy] = useState(false);
  const [openingEditor, setOpeningEditor] = useState(false);
  // Opening a tool usually takes a moment; the card only appears when copying a large PDF is slow.
  const [openingSlow, setOpeningSlow] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const searchAvailable = !!PdfEngine?.nativeReaderSearchVersion;
  const replaceAvailable = !!PdfEngine?.nativeFindReplaceVersion;
  const focusAvailable = !!PdfEngine?.nativeReaderFocusVersion;
  const search = usePdfSearch(document?.uri, searchQuery, screenActive && searchOpen && !openingEditor && !loading);
  const searchMatch = search.query === searchQuery.trim() ? search.matches[searchIndex] : undefined;
  const [busyLabel, setBusyLabel] = useState('Preparing PDF...');
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const toolLayout = usePdfToolLayout();
  const [localLandscape, setLocalLandscape] = useState(false);
  const landscapeRequested = toolLayout?.landscape ?? localLandscape;
  const setLandscapeRequested = toolLayout?.setLandscape ?? setLocalLandscape;
  const [previousLandscape, setPreviousLandscape] = useState(landscape);
  if (previousLandscape !== landscape) {
    setPreviousLandscape(landscape);
    setZoomRequest(current => ({ value: 1, revision: current.revision + 1 }));
  }
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const mounted = useRef(true);
  const ownedFile = useRef<string | null>(null);
  const actionLock = useRef(false);
  const [wasActive, setWasActive] = useState(screenActive);
  // Reset before children render, so thumbnails cannot restart against a reopening reader.
  if (wasActive !== screenActive) {
    setWasActive(screenActive);
    if (!screenActive) { setOpeningEditor(false); setOpeningSlow(false); setStripReady(false); }
  }
  // The covered reader stays on screen until the push transition has finished, so no loading
  // card slides out with it. Then its native view is released.
  const [released, setReleased] = useState(!screenActive);
  if (screenActive && released) setReleased(false);
  useEffect(() => {
    if (screenActive) return;
    const timer = setTimeout(() => { setReleased(true); setLoading(!!document); }, RELEASE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [screenActive, document]);
  const readerMounted = screenActive || !released;
  useEffect(() => { if (document) void rememberFile(document, 'pdf').catch(() => { /* Temporary tool inputs are not kept in Recents. */ }); }, [document]);
  useEffect(() => { onFocusChange?.(focused); }, [focused, onFocusChange]);
  const [previousSearchMatches, setPreviousSearchMatches] = useState(search.matches);
  if (previousSearchMatches !== search.matches) {
    setPreviousSearchMatches(search.matches);
    setSearchIndex(0);
    const first = search.matches[0];
    if (first) {
      setPage(first.page);
      setPageRequest(current => ({ value: first.page, revision: current.revision + 1 }));
      setZoomRequest(current => ({ value: 1, revision: current.revision + 1 }));
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => { if (!mounted.current && !actionLock.current && ownedFile.current) removeViewerFile(ownedFile.current); });
    };
  }, []);

  // Thumbnails start once the first pages are on screen so opening stays smooth.
  useEffect(() => {
    if (!screenActive) return;
    const timer = setTimeout(() => setStripReady(!loading), loading ? 0 : 350);
    return () => clearTimeout(timer);
  }, [loading, screenActive, document]);

  useEffect(() => {
    if (loading || !screenActive) return;
    const timer = setTimeout(prunePdfCache, 1500);
    return () => clearTimeout(timer);
  }, [loading, screenActive]);

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
      const saved = await saveExistingFile({ ...document, name, mimeType: 'application/pdf', kind: 'pdf' });
      if (saved && mounted.current) showDialog('PDF saved', `${saved.file.name}\nSaved to ${saved.device.location}`, undefined, { ios: 'checkmark.circle', android: 'check-circle' });
    } catch (cause) {
      if (mounted.current) setActionError((cause as Error).message || 'Could not save this PDF. Please try again.');
    } finally {
      actionLock.current = false;
      if (mounted.current) setBusy(false);
      else if (ownedFile.current) removeViewerFile(ownedFile.current);
    }
  }

  usePublishHeaderShare({ active: !!document && !!toolLayout, disabled: busy, label: 'Share PDF', onShare: exportDocument,
    save: { disabled: busy, label: 'Save PDF to device', onSave: saveDocument } });
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
  }
  function goToSearchResult(direction: number) {
    if (!search.matches.length) return;
    const index = (searchIndex + direction + search.matches.length) % search.matches.length;
    const match = search.matches[index];
    setSearchIndex(index); setPage(match.page);
    setPageRequest(current => ({ value: match.page, revision: current.revision + 1 }));
    requestZoom(1); Keyboard.dismiss();
  }

  function requestZoom(value: number) {
    const next = Math.max(1, Math.min(5, value));
    setZoomRequest(current => ({ value: next, revision: current.revision + 1 }));
  }

  function performOption(id: string) {
    if (actionLock.current) return;
    Keyboard.dismiss();
    if (id === 'search') { if (searchAvailable) { setSearchOpen(true); setFocused(false); } return; }
    if (id === 'previous') { goToPage(page - 1); return; }
    if (id === 'next') { goToPage(page + 1); return; }
    if (id === 'orientation') { setLandscapeRequested(value => !value); return; }
    if (id === 'open') { void chooseFile(); return; }
    if (id === 'save') { void saveDocument(); return; }
    if (id === 'share') { void exportDocument(); return; }
    if (id === 'thumbnails') { setThumbnails(value => !value); return; }
    if (id === 'fit') { requestZoom(1); return; }
    if (id === 'focus') { setFocused(true); return; }
    if (id === 'surround') { ring.toggle(); setPageRequest(current => ({ value: page, revision: current.revision + 1 })); requestZoom(1); return; }
    if (id === 'scroll') { setVertical(value => !value); setPageRequest(current => ({ value: page, revision: current.revision + 1 })); requestZoom(1); return; }
    if (implementedPdfTools.has(id)) void openDocumentTool(id as PdfTool);
  }

  async function openDocumentTool(tool: PdfTool, query?: string) {
    if (!document || actionLock.current) return;
    const method = PDF_SECTIONS.flatMap(section => [...section.tools]).find(item => item.id === tool);
    if (!method) return;
    actionLock.current = true; setOpeningEditor(true); setBusy(true); setBusyLabel(`Opening ${method.title}...`); setActionError(null);
    let session: string | null = null;
    const slow = setTimeout(() => { if (mounted.current) setOpeningSlow(true); }, SLOW_OPEN_MS);
    try {
      session = await createPdfToolForDocument(tool, method.title, document, page, pathname === '/file-preview' || pathname === '/pdf-viewer' ? pathname : undefined, query);
      if (!session) { setOpeningEditor(false); return; }
      if (!mounted.current) { discardPdfToolSession(session); return; }
      // The tool opens on the same page and in the same orientation as the reader.
      router.push({ pathname: '/pdf-tool', params: landscapeRequested ? { session, landscape: '1' } : { session } });
    } catch (cause) {
      if (session) discardPdfToolSession(session);
      if (mounted.current) { setOpeningEditor(false); setActionError((cause as Error).message || 'Could not open this tool. Please try again.'); }
    } finally {
      clearTimeout(slow);
      if (mounted.current) setOpeningSlow(false);
      actionLock.current = false;
      if (mounted.current) setBusy(false);
      else if (ownedFile.current) removeViewerFile(ownedFile.current);
    }
  }

  const ready = !!document && pageCount > 0 && !error;
  const ring = useToolRing(ready && !focused);
  const tools = useMemo<RailTool[]>(() => [
    ...(searchAvailable ? [{ id: 'search', title: 'Search PDF', ios: 'doc.text.magnifyingglass' as const, android: 'search' as const }] : []),
    { id: 'orientation', title: landscapeRequested ? 'Portrait' : 'Landscape', ios: 'rectangle', android: 'screen-rotation', highlighted: true, accessibilityLabel: `Switch to ${landscapeRequested ? 'portrait' : 'landscape'} view` },
    ...editTools,
    { id: 'scroll', title: vertical ? 'Single page' : 'Scroll', ios: vertical ? 'doc' : 'arrow.up.arrow.down', android: vertical ? 'crop-portrait' : 'swap-vert', highlighted: true, accessibilityLabel: vertical ? 'Switch to one page at a time' : 'Switch to vertical scrolling' },
    { id: 'fit', title: 'Fit page', ios: 'arrow.down.right.and.arrow.up.left', android: 'fit-screen' },
    { id: 'thumbnails', title: thumbnails ? 'Hide pages' : 'Pages', ios: 'square.grid.2x2', android: 'view-carousel', accessibilityLabel: thumbnails ? 'Hide page thumbnails' : 'Show page thumbnails' },
    { id: 'focus', title: 'Focus', ios: 'arrow.up.left.and.arrow.down.right', android: 'fullscreen' },
    ...fileTools, ...upcomingTools,
  ], [searchAvailable, landscapeRequested, vertical, thumbnails]);
  const visibleTools = useMemo(() => landscape ? tools.filter(tool => !['scroll', 'orientation'].includes(tool.id)) : tools.filter(tool => tool.id !== 'orientation'), [landscape, tools]);
  const toolboxSections = useMemo(() => railSections(visibleTools), [visibleTools]);
  const surrounding = ring.active;
  // Keep every visible page readable, including several short image pages at the end.
  const surroundTools = useMemo(() => tools.filter(tool => !tool.soon && !['fit', 'thumbnails', 'orientation', 'scroll'].includes(tool.id)), [tools]);
  const showStrip = ready && !surrounding && !busy && !openingEditor && !focused && thumbnails && stripReady && screenActive && !!document;
  const strip = showStrip && !landscape ? <PdfPageStrip enabled={!toolboxOpen} uri={document.uri} count={pageCount} page={page} onSelect={goToPage} /> : null;
  // Landscape keeps the page full height: odd pages list on the left, even pages on the right.
  const sideStrip = (parity: 0 | 1) => showStrip && landscape && pageCount > parity ? <PdfPageStrip enabled={!toolboxOpen} vertical parity={parity} uri={document.uri} count={pageCount} page={page} onSelect={goToPage} /> : null;
  const controls = ready && !focused;
  // Search takes the page row's place; closing it brings the row back.
  const searching = controls && searchOpen;
  const searchMessage = search.busy ? 'Searching on your device...' : search.error || (!searchQuery.trim() ? 'Search selectable PDF text' : search.matches.length ? `Result ${searchIndex + 1} of ${search.matches.length}${search.truncated ? '+, narrow your search' : ''}` : 'No matches. Scanned pages may need OCR.');
  const orientation = { landscape: landscapeRequested, onToggle: () => performOption('orientation') };
  // Standalone, landscape moves the switch next to the header's close button so it never covers the rails.
  usePublishHeaderOrientation({ active: controls && landscape && !toolLayout, landscape: landscapeRequested, disabled: busy || loading, onToggle: orientation.onToggle });
  const pageBar = controls && <PdfPreviewToolbar page={page + 1} count={pageCount} disabled={busy || loading} onPageChange={target => goToPage(target - 1)} orientation={toolLayout ? undefined : orientation} rotate={!landscape || !!toolLayout}
    leading={<>
      <ToolRowButton label="Fit page" icon={{ ios: 'arrow.down.right.and.arrow.up.left', android: 'fit-screen' }} disabled={busy || loading} onPress={() => performOption('fit')} />
      <ToolRowButton label="All tools" icon={{ ios: 'square.grid.2x2', android: 'grid-view' }} expanded={toolboxOpen} disabled={busy || loading} onPress={() => { Keyboard.dismiss(); ring.close(); setToolboxOpen(true); }} />
    </>}>
    {surrounding ? <ToolSurroundCloseButton compact disabled={ring.closing} onPress={ring.close} /> : searchAvailable && <ToolRowButton label="Search PDF" icon={{ ios: 'magnifyingglass', android: 'search' }} selected={searchOpen} disabled={busy || loading} onPress={() => performOption('search')} />}
    {landscape && <ToolRowButton label={thumbnails ? 'Hide page thumbnails' : 'Show page thumbnails'} icon={{ ios: 'square.grid.2x2', android: 'view-carousel' }} selected={thumbnails} onPress={() => performOption('thumbnails')} />}
  </PdfPreviewToolbar>;
  return (
    <View style={styles.screen}>
      {!toolLayout && <Stack.Screen options={{ orientation: landscapeRequested ? 'landscape' : 'portrait' }} />}
      {!isPdfEngineAvailable ? (
        <View style={styles.empty}>
          <UniversalIcon ios="doc.richtext" android="picture-as-pdf" size={40} color={colors.systemBlue} />
          <ThemedText style={styles.heading}>Native PDF viewer</ThemedText>
          <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{Platform.OS === 'web' ? 'Open this tool in the Android or iOS app.' : 'Install a development build containing the PDF engine to open documents.'}</ThemedText>
        </View>
      ) : (
        <>
          {actionError && <ThemedText accessibilityRole="alert" style={[styles.message, { color: colors.label, backgroundColor: colors.accentSurface }]}>{actionError}</ThemedText>}
          {searching && <View style={[styles.searchPanel, { borderColor: colors.separator, backgroundColor: colors.systemBackground }]}>
            <View style={styles.searchRow}>
              <UniversalIcon ios="magnifyingglass" android="search" size={20} color={colors.systemBlue} />
              <TextInput accessibilityLabel="Search text in PDF" autoFocus value={searchQuery} onChangeText={setSearchQuery} maxLength={128} returnKeyType="search" autoCapitalize="none" autoCorrect={false} onSubmitEditing={Keyboard.dismiss} placeholder="Find in this PDF" placeholderTextColor={colors.secondaryLabel} style={[styles.searchInput, { color: colors.label, backgroundColor: colors.accentSurface }]} />
              {!!searchQuery.trim() && <ThemedText accessibilityLiveRegion="polite" accessibilityLabel={searchMessage} numberOfLines={1} style={[styles.searchCount, { color: search.error ? colors.destructive : colors.secondaryLabel }]}>{search.busy ? '…' : search.error ? '!' : search.matches.length ? `${searchIndex + 1}/${search.matches.length}${search.truncated ? '+' : ''}` : '0'}</ThemedText>}
              <Pressable accessibilityRole="button" accessibilityLabel="Previous search result" disabled={!search.matches.length || search.busy} onPress={() => goToSearchResult(-1)} style={[styles.iconButton, (!search.matches.length || search.busy) && styles.disabled]}><UniversalIcon ios="chevron.up" android="keyboard-arrow-up" size={24} color={colors.systemBlue} /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Next search result" disabled={!search.matches.length || search.busy} onPress={() => goToSearchResult(1)} style={[styles.iconButton, (!search.matches.length || search.busy) && styles.disabled]}><UniversalIcon ios="chevron.down" android="keyboard-arrow-down" size={24} color={colors.systemBlue} /></Pressable>
              {replaceAvailable && <Pressable accessibilityRole="button" accessibilityLabel="Find and replace this text" disabled={busy} onPress={() => { Keyboard.dismiss(); void openDocumentTool('replace_text', searchQuery.trim()); }} style={[styles.iconButton, busy && styles.disabled]}><UniversalIcon ios="text.magnifyingglass" android="find-replace" size={22} color={colors.systemBlue} /></Pressable>}
              <Pressable accessibilityRole="button" accessibilityLabel="Close PDF search" onPress={() => { setSearchOpen(false); setSearchQuery(''); Keyboard.dismiss(); }} style={styles.iconButton}><UniversalIcon ios="xmark" android="close" size={22} color={colors.systemBlue} /></Pressable>
            </View>
            {!!searchQuery.trim() && !search.busy && (!!search.error || !search.matches.length) && <ThemedText accessibilityRole={search.error ? 'alert' : undefined} style={[styles.searchStatus, { color: search.error ? colors.destructive : colors.secondaryLabel }]}>{searchMessage}</ThemedText>}
          </View>}
          {!landscape && !searching && pageBar}
          <View style={styles.body2}>
          <View style={[styles.body2, landscape && styles.row]}>
          {landscape && !searching && pageBar}
          {sideStrip(0)}
          <ToolSurround active={surrounding && !ring.closing} naming={ring.naming} tools={surroundTools} disabled={busy || loading} showClose={false} onAction={performOption} onClose={ring.close} onHidden={ring.finishClose}>
          <View style={[styles.canvas, landscape && !surrounding && styles.landscapeCanvas, { backgroundColor: colors.systemBackground }]}>
            {document && !error && readerMounted && <PdfEngineView
              key={document.uri}
              uri={document.uri}
              page={page}
              pageRevision={pageRequest.revision}
              vertical={!landscape && (surrounding || vertical)}
              {...(focusAvailable ? { focusCurrent: false } : {})}
              zoom={zoomRequest.value}
              zoomRevision={zoomRequest.revision}
              dark={mode === 'dark'}
              {...(searchAvailable ? { searchHighlights: searchOpen && searchMatch ? JSON.stringify({ ...searchMatch, result: searchIndex, query: searchQuery.trim() }) : '' } : {})}
              style={styles.nativeView}
              onLoad={({ nativeEvent }) => { setPageCount(nativeEvent.pageCount); setLoading(false); }}
              onPageChange={({ nativeEvent }) => { setPage(nativeEvent.page); setLoading(false); }}
              onZoomChange={() => {}}
              onError={({ nativeEvent }) => { setError(nativeEvent.message); setLoading(false); }}
            />}
            {((busy && (!openingEditor || openingSlow)) || (loading && !error && screenActive)) && <View pointerEvents="none" style={[styles.loading, { backgroundColor: loading || !document || error ? colors.systemBackground : 'transparent' }]}><View style={[styles.loadingCard, { backgroundColor: colors.secondarySystemBackground, borderColor: colors.separator }]}><AppLoader size="large" /><ThemedText accessibilityLiveRegion="polite" style={styles.rowTitle}>{busy ? busyLabel : 'Opening PDF...'}</ThemedText><ThemedText numberOfLines={2} style={[styles.body, { color: colors.secondaryLabel }]}>{document?.name ?? 'Choose a document to continue'}</ThemedText></View></View>}
            {(!document || error) && !busy && <View style={styles.empty}>
              <UniversalIcon ios={error ? 'exclamationmark.triangle' : 'doc.richtext'} android={error ? 'error-outline' : 'picture-as-pdf'} size={40} color={colors.systemBlue} />
              <ThemedText style={styles.heading}>{error ? 'Unable to display PDF' : 'Your documents, on your device'}</ThemedText>
              <ThemedText style={[styles.body, { color: colors.secondaryLabel }]}>{error ?? 'Choose a PDF, swipe up to read and pinch to zoom. Editing and reading tools appear below.'}</ThemedText>
            </View>}
          </View>
          </ToolSurround>
          {strip}
          {sideStrip(1)}
          {ready && !focused && !surrounding && <ToolRail tools={visibleTools} quickIds={quickIds} disabled={busy || loading} landscape={landscape} onAction={performOption}
            toolsButton={{ label: 'Tools', accessibilityLabel: 'Show all tools around the page', onPress: () => performOption('surround') }} />}
          {ready && <ToolboxSheet visible={toolboxOpen && !surrounding && screenActive} title="All tools" subtitle={document?.name ?? 'PDF'} sections={toolboxSections} footer={<View />} onClose={() => setToolboxOpen(false)} onAction={performOption} />}
          </View>
          </View>
          {focused && <Pressable accessibilityRole="button" accessibilityLabel="Exit focus view and show controls" onPress={() => setFocused(false)} style={[styles.restore, { backgroundColor: colors.accentSurface }]}><UniversalIcon ios="arrow.down.right.and.arrow.up.left" android="fullscreen-exit" size={22} color={colors.systemBlue} /><ThemedText style={{ color: colors.systemBlue }}>Show controls</ThemedText></Pressable>}
          {(!document || error) && <Pressable accessibilityRole="button" disabled={busy} onPress={chooseFile} style={[styles.openButton, getGradients(colors).module]}><UniversalIcon ios="folder" android="folder-open" size={22} color={colors.moduleText} /><ThemedText style={{ color: colors.moduleText }}>Choose PDF</ThemedText></Pressable>}
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  searchPanel: { borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingVertical: 2 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  searchCount: { minWidth: 28, fontSize: 13, textAlign: 'center', fontVariant: ['tabular-nums'] },
  searchInput: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, fontSize: 15 },
  searchStatus: { fontSize: 12, paddingHorizontal: 28, paddingBottom: 4 },
  restore: { position: 'absolute', bottom: 16, alignSelf: 'center', minHeight: 48, paddingHorizontal: 16, borderRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  message: { ...t.caption, marginHorizontal: s.lg, padding: s.md, borderRadius: radius.sm },
  canvas: { flex: 1, minHeight: 120 },
  nativeView: { flex: 1 },
  landscapeCanvas: { padding: 8 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: s.lg, padding: s.xxl },
  heading: { ...t.heading, textAlign: 'center' },
  body: { ...t.body, textAlign: 'center' },
  loading: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center' },
  body2: { flex: 1 },
  row: { flexDirection: 'row' },
  loadingCard: { maxWidth: 300, padding: 24, margin: 20, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', gap: 12 },
  rowTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  openButton: { minHeight: 48, margin: 16, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  disabled: { opacity: 0.35 },
});
