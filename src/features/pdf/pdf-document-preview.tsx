import { type ReactNode, useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { File, FileMode } from 'expo-file-system';
import { PdfEngine } from '../../../modules/pdf-engine';
import { AppLoader } from '@/components/app-loader';
import { ThemedText } from '@/components/themed-text';
import { ToolButton } from '@/components/tool-button';
import { createImportDirectory, disposeImports } from '../files/file-storage';
import { usePdfScreenActive } from './use-pdf-screen-active';
import { PdfPagePreview, PdfPreviewBody, PdfPreviewFooter, PdfPreviewStage, PdfPreviewToolbar, type PdfPreviewImage } from './pdf-preview';

/** Read the native PNG's 24-byte header without decoding/caching another bitmap. */
function previewDimensions(image: File) {
  const handle = image.open(FileMode.ReadOnly);
  try {
    const bytes = handle.readBytes(24);
    if (bytes.length !== 24) throw new Error('Incomplete page preview. Try again.');
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a || header.getUint32(12) !== 0x49484452) throw new Error('Invalid page preview. Try again.');
    const width = header.getUint32(16), height = header.getUint32(20);
    if (!width || !height || width * height > 12_000_000) throw new Error('This page preview is too large to display.');
    return { width, height };
  } finally { handle.close(); }
}

/** Borrows the tool's source while it is mounted; owns only preview files and jobs. */
export function PdfDocumentPreview({ uri, count, initialPage = 1, inputPassword = '', onClose, embedded = false, toolbarActions, page: controlledPage, onPageChange, rotation = 0, disabled = false }: {
  uri: string; count: number; initialPage?: number; inputPassword?: string; onClose: () => void; embedded?: boolean; toolbarActions?: ReactNode; page?: number; onPageChange?: (page: number) => void; rotation?: number; disabled?: boolean;
}) {
  const active = usePdfScreenActive();
  const [directory] = useState(createImportDirectory);
  const [localPage, setLocalPage] = useState(Math.max(1, Math.min(count, initialPage)));
  const page = Math.max(1, Math.min(count, controlledPage ?? localPage));
  const changePage = (next: number) => { setLoading(true); setPreview(undefined); setLocalPage(next); onPageChange?.(next); };
  const [preview, setPreview] = useState<PdfPreviewImage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const mounted = useRef(true);
  const pending = useRef(Promise.resolve());
  const previousImage = useRef<File | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => { if (!mounted.current) void pending.current.finally(() => { if (!mounted.current) disposeImports(directory); }); });
    };
  }, [directory]);
  useEffect(() => {
    if (!active || embedded) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => listener.remove();
  }, [active, onClose, embedded]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    const id = `page-preview-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const image = new File(directory, `${id}.png`);
    pending.current = pending.current.then(async () => {
      if (!current) return;
      setLoading(true); setError(''); setPreview(undefined);
      let keep = false;
      try {
        if (!PdfEngine?.nativeAdvancedToolsVersion) throw new Error('Install a new development build to preview this PDF.');
        directory.create({ intermediates: true, idempotent: true });
        if (!current) return;
        await PdfEngine.editPdfText(id, JSON.stringify({ action: 'preview', includeObjects: false, uri, inputPassword, page: page - 1, edits: [], imageUri: image.uri }));
        if (!current) return;
        const dimensions = previewDimensions(image);
        setPreview({ uri: image.uri, ...dimensions }); keep = true;
        try { previousImage.current?.delete(); } catch { /* Session cleanup retries. */ }
        previousImage.current = image;
      } catch (cause) {
        if (current) setError((cause as Error).message || 'Could not preview this page.');
      } finally {
        if (!keep) try { if (image.exists) image.delete(); } catch { /* Session cleanup retries. */ }
        if (current) setLoading(false);
      }
    });
    return () => { current = false; PdfEngine?.cancelTextEdit(id); };
  }, [uri, page, inputPassword, active, retry, directory]);
  return <View style={styles.screen}>
    <PdfPreviewBody pages={inputPassword ? null : { uri, count, page: page - 1, onSelect: target => { if (!disabled && target + 1 !== page) changePage(target + 1); } }} toolbar={<PdfPreviewToolbar page={page} count={count} disabled={loading || disabled} onPageChange={changePage}>{toolbarActions}</PdfPreviewToolbar>}>
    {preview ? <PdfPagePreview image={preview} active={active} rotation={rotation} /> : <PdfPreviewStage hint="Original PDF">
      <View style={styles.empty}>{loading ? <><AppLoader /><ThemedText>Preparing page...</ThemedText></> : <><ThemedText accessibilityRole="alert">{error}</ThemedText><ToolButton title="Retry preview" onPress={() => setRetry(value => value + 1)} /></>}</View>
    </PdfPreviewStage>}
    </PdfPreviewBody>
    {!embedded && <PdfPreviewFooter><ThemedText>Original PDF - changes appear in the saved result.</ThemedText><ToolButton title="Back to tool" secondary onPress={onClose} /></PdfPreviewFooter>}
  </View>;
}
const styles = StyleSheet.create({ screen: { flex: 1 }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 } });
