import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppBottomSheet } from '@/components/app-bottom-sheet';
import { AppLoader } from '@/components/app-loader';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { PdfEngine } from '../../../modules/pdf-engine';
import { formatSize } from '../files/file-storage';

type Info = { pageCount: number; size: number; width: number; height: number; version: string; encrypted: boolean; title: string; author: string; subject: string; creator: string; producer: string };
type Row = { label: string; value: string };

const PAPER: [string, number, number][] = [['A3', 842, 1191], ['A4', 595, 842], ['A5', 420, 595], ['Letter', 612, 792], ['Legal', 612, 1008], ['Tabloid', 792, 1224]];
function paperSize(width: number, height: number) {
  const short = Math.min(width, height), long = Math.max(width, height);
  const name = PAPER.find(([, w, h]) => Math.abs(w - short) <= 3 && Math.abs(h - long) <= 3)?.[0];
  const mm = (points: number) => Math.round(points / 72 * 25.4);
  const size = `${mm(width)} × ${mm(height)} mm`;
  return name ? `${name} ${width > height ? 'landscape' : 'portrait'} · ${size}` : size;
}

/** Document facts read on the device, shown over the reader so the PDF stays open behind them. */
export function PdfDetailsSheet({ visible, uri, name, pageCount, password, onClose }: { visible: boolean; uri: string; name: string; pageCount: number; password: string; onClose: () => void }) {
  const colors = usePalette();
  const [loaded, setLoaded] = useState<{ key: string; info: Info | null } | null>(null);
  const key = `${uri}|${password}`;
  const available = !!PdfEngine?.nativeAdvancedToolsVersion;
  useEffect(() => {
    if (!visible || !available || loaded?.key === key) return;
    let current = true;
    const id = `details-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    PdfEngine!.processPdf(id, JSON.stringify({ operation: 'info', uri, inputPassword: password }))
      .then(raw => { if (current) setLoaded({ key, info: (JSON.parse(raw) as { info?: Info }).info ?? null }); })
      .catch(() => { if (current) setLoaded({ key, info: null }); });
    return () => { current = false; PdfEngine?.cancelPdfTool(id); };
  }, [visible, available, key, uri, password, loaded?.key]);

  const info = loaded?.key === key ? loaded.info : undefined;
  const loading = available && info === undefined;
  const file: Row[] = [
    { label: 'Pages', value: String(info?.pageCount ?? pageCount) },
    ...(info ? [
      { label: 'Size', value: formatSize(info.size) },
      { label: 'Page size', value: paperSize(info.width, info.height) },
      { label: 'PDF version', value: info.version || 'Unknown' },
      { label: 'Password', value: info.encrypted ? 'Protected' : 'None' },
    ] : []),
  ];
  const properties: Row[] = info ? ([['Title', info.title], ['Author', info.author], ['Subject', info.subject], ['Created with', info.creator], ['Produced by', info.producer]] as const)
    .filter(([, value]) => !!value?.trim()).map(([label, value]) => ({ label, value: value.trim() })) : [];

  const section = (title: string, rows: Row[]) => <View style={styles.section}>
    <ThemedText style={[styles.sectionTitle, { color: colors.secondaryLabel }]}>{title}</ThemedText>
    <View style={[styles.card, { backgroundColor: colors.fieldSurface }]}>
      {rows.map((row, index) => <View key={row.label} accessible accessibilityLabel={`${row.label}: ${row.value}`} style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator }]}>
        <ThemedText style={[styles.label, { color: colors.secondaryLabel }]}>{row.label}</ThemedText>
        <ThemedText selectable style={[styles.value, { color: colors.label }]}>{row.value}</ThemedText>
      </View>)}
    </View>
  </View>;

  return <AppBottomSheet visible={visible} onClose={onClose} title="File details" icon={{ ios: 'info.circle', android: 'info-outline' }}>
    <View style={[styles.hero, { backgroundColor: colors.accentSurface }]}>
      <View style={[styles.badge, { backgroundColor: colors.systemBackground }]}><UniversalIcon ios="doc.richtext" android="picture-as-pdf" size={26} color={colors.systemBlue} /></View>
      <View style={styles.grow}>
        <ThemedText selectable numberOfLines={3} style={[styles.name, { color: colors.label }]}>{name}</ThemedText>
        <ThemedText style={[styles.summary, { color: colors.secondaryLabel }]}>PDF · {info?.pageCount ?? pageCount} {(info?.pageCount ?? pageCount) === 1 ? 'page' : 'pages'}{info ? ` · ${formatSize(info.size)}` : ''}</ThemedText>
      </View>
    </View>
    {section('File', file)}
    {loading && <View style={styles.status}><AppLoader /><ThemedText style={{ color: colors.secondaryLabel }}>Reading document details…</ThemedText></View>}
    {!loading && (properties.length ? section('Document properties', properties)
      : <ThemedText style={[styles.note, { color: colors.secondaryLabel }]}>{info ? 'This PDF has no title, author or other document properties.' : available ? 'Could not read more details from this PDF.' : 'More details need the latest app build.'}</ThemedText>)}
  </AppBottomSheet>;
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderCurve: 'continuous' },
  badge: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
  summary: { fontSize: 13, lineHeight: 18 },
  section: { gap: 6 },
  sectionTitle: { fontSize: 13, fontWeight: '600', paddingHorizontal: 4 },
  card: { borderRadius: 14, borderCurve: 'continuous', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  label: { width: 104, fontSize: 14, lineHeight: 20 },
  value: { flex: 1, fontSize: 14, lineHeight: 20, textAlign: 'right' },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 12 },
  note: { fontSize: 13, lineHeight: 18, textAlign: 'center', paddingVertical: 8 },
});
