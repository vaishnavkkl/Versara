import { useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { BottomSheet, Host, RNHostView } from '@expo/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PDF_SECTIONS, type Method } from '@/constants/pdf-methods';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { useAppearance, usePalette } from '@/theme/colors';
import { getGradients } from '@/theme/dashboard';
import { implementedPdfTools } from './pdf-tool-session';

type Action = Method & { unavailable?: boolean };
type Props = {
  visible: boolean; name: string; pageCount: number; vertical: boolean;
  onClose: () => void; onAction: (id: string) => void;
};

export function PdfViewerOptions({ visible, name, pageCount, vertical, onClose, onAction }: Props) {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const insets = useSafeAreaInsets();
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
  return <Host colorScheme={mode}>
    <BottomSheet isPresented={visible} onDismiss={onClose} snapPoints={['half', 'full']} showDragIndicator containerColor={colors.systemBackground} contentPadding={{ top: 0, bottom: 0, left: 0, right: 0 }}>
      <RNHostView>
        <View style={[styles.sheet, { backgroundColor: colors.systemBackground }]}>
          <View style={[styles.header, { borderColor: colors.separator }]}>
            <View style={styles.grow}><ThemedText accessibilityRole="header" style={styles.title}>PDF options</ThemedText><ThemedText numberOfLines={1} style={{ color: colors.secondaryLabel }}>{name}</ThemedText><ThemedText style={styles.caption}>{pageCount} {pageCount === 1 ? 'page' : 'pages'}</ThemedText></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close PDF options" onPress={onClose} style={[styles.close, { backgroundColor: colors.accentSurface }]}><UniversalIcon ios="xmark" android="close" size={22} color={colors.systemBlue} /></Pressable>
          </View>
          <SectionList<Action> sections={sections} keyExtractor={item => item.id} stickySectionHeadersEnabled={false} initialNumToRender={10} maxToRenderPerBatch={8} windowSize={5} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom, 16) }}
            renderSectionHeader={({ section }) => <ThemedText accessibilityRole="header" style={[styles.sectionTitle, { color: colors.secondaryLabel }]}>{section.title}</ThemedText>}
            renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.unavailable ? 'Coming later' : item.subtitle}`} accessibilityState={{ disabled: !!item.unavailable }} disabled={item.unavailable} onPress={() => onAction(item.id)} android_ripple={{ color: colors.accentSurface }} style={({ pressed }) => [styles.row, { borderColor: colors.separator, opacity: item.unavailable ? 0.55 : pressed ? 0.7 : 1 }]}>
              <View style={[styles.icon, getGradients(colors).module]}><UniversalIcon ios={item.ios} android={item.android} size={22} color={colors.moduleText} /></View>
              <View style={styles.grow}><ThemedText style={styles.rowTitle}>{item.title}</ThemedText><ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>{item.subtitle}</ThemedText></View>
              {item.unavailable ? <ThemedText style={styles.caption}>Soon</ThemedText> : <UniversalIcon ios="chevron.right" android="chevron-right" size={18} color={colors.secondaryLabel} />}
            </Pressable>}
            ListFooterComponent={<Pressable accessibilityRole="button" accessibilityState={{ expanded: showUpcoming }} onPress={() => setShowUpcoming(value => !value)} style={styles.more}><ThemedText style={{ color: colors.systemBlue }}>{showUpcoming ? 'Hide upcoming tools' : 'View upcoming PDF tools'}</ThemedText><UniversalIcon ios={showUpcoming ? 'chevron.up' : 'chevron.down'} android={showUpcoming ? 'expand-less' : 'expand-more'} size={20} color={colors.systemBlue} /></Pressable>}
          />
        </View>
      </RNHostView>
    </BottomSheet>
  </Host>;
}

const styles = StyleSheet.create({
  sheet: { flex: 1 }, grow: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 20, fontWeight: '600', lineHeight: 28 }, caption: { fontSize: 12, lineHeight: 18 },
  close: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '600', paddingTop: 20, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowTitle: { fontSize: 16, fontWeight: '500', lineHeight: 22 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  more: { minHeight: 56, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
