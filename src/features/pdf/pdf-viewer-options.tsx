import { useMemo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { ToolboxSheet } from '@/components/toolbox-sheet';
import { PDF_SECTIONS, type Method } from '@/constants/pdf-methods';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { typography as t } from '@/theme/dashboard';
import { implementedPdfTools } from './pdf-tool-session';

type Action = Method & { unavailable?: boolean };
type Props = {
  visible: boolean; name: string; pageCount: number; vertical: boolean;
  onClose: () => void; onAction: (id: string) => void;
};

export function PdfViewerOptions({ visible, name, pageCount, vertical, onClose, onAction }: Props) {
  const colors = usePalette();
  const [showUpcoming, setShowUpcoming] = useState(false);
  const sections = useMemo(() => {
    const reading: Action[] = [
      { id: 'scroll', title: vertical ? 'Vertical scrolling' : 'Single page', subtitle: vertical ? 'Tap to switch to one page at a time' : 'Tap to scroll through every page', ios: 'arrow.up.arrow.down', android: 'swap-vert' },
      { id: 'fit', title: 'Fit page', subtitle: 'Reset the zoom', ios: 'arrow.down.right.and.arrow.up.left', android: 'fit-screen' },
      { id: 'focus', title: 'Focus view', subtitle: 'Hide controls for more reading space', ios: 'arrow.up.left.and.arrow.down.right', android: 'fullscreen' },
      { id: 'info', title: 'Document details', subtitle: 'File name, size and page count', ios: 'info.circle', android: 'info-outline' },
      { id: 'save', title: 'Save a copy', subtitle: 'Export this PDF to your device', ios: 'square.and.arrow.down', android: 'save-alt' },
      { id: 'open', title: 'Open another PDF', subtitle: 'Choose a different document', ios: 'folder', android: 'folder-open' },
    ];
    const tools = PDF_SECTIONS.filter(section => section.title !== 'Read & explore').map(section => ({
      title: section.title,
      data: section.tools.filter(tool => implementedPdfTools.has(tool.id)).map(tool => ({ ...tool, subtitle: tool.id === 'merge' ? 'Add more PDFs to this document' : tool.subtitle } as Action)),
    })).filter(section => section.data.length).sort((a, b) => {
      const order = ['Edit & annotate', 'Organize pages', 'Convert & optimize'];
      return order.indexOf(a.title) - order.indexOf(b.title);
    });
    const upcoming = PDF_SECTIONS.flatMap(section => [...section.tools]).filter(tool => !implementedPdfTools.has(tool.id) && tool.id !== 'info').map(tool => ({ ...tool, unavailable: true }));
    return [...tools, { title: 'Reading & file', data: reading }, ...(showUpcoming ? [{ title: 'Coming later', data: upcoming }] : [])];
  }, [vertical, showUpcoming]);
  return <ToolboxSheet visible={visible} title="PDF toolbox" subtitle={name} caption={`${pageCount} ${pageCount === 1 ? 'page' : 'pages'} · editing tools below`}
    sections={sections} onClose={onClose} onAction={onAction}
    footer={<Pressable accessibilityRole="button" accessibilityState={{ expanded: showUpcoming }} onPress={() => setShowUpcoming(value => !value)} style={styles.more}><ThemedText style={[styles.body, { color: colors.systemBlue }]}>{showUpcoming ? 'Hide upcoming tools' : 'View upcoming PDF tools'}</ThemedText><UniversalIcon ios={showUpcoming ? 'chevron.up' : 'chevron.down'} android={showUpcoming ? 'expand-less' : 'expand-more'} size={20} color={colors.systemBlue} /></Pressable>} />;
}

const styles = StyleSheet.create({
  body: { ...t.body },
  more: { minHeight: 56, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
