import { useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { BottomSheet, Host, RNHostView } from '@expo/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IMAGE_SECTIONS } from '@/constants/image-methods';
import { VIDEO_SECTIONS } from '@/constants/video-methods';
import { AUDIO_SECTIONS } from '@/constants/audio-methods';
import type { Method } from '@/constants/pdf-methods';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { useAppearance, usePalette } from '@/theme/colors';
import { getGradients } from '@/theme/dashboard';
import { FILE_LABELS, type RecentFile } from './recent-files';

type Action = Method & { unavailable?: boolean };
export function MediaOptions({ file, visible, onClose, onAction }: { file: RecentFile; visible: boolean; onClose: () => void; onAction: (id: string) => void }) {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const insets = useSafeAreaInsets();
  const [upcoming, setUpcoming] = useState(false);
  const sections = useMemo(() => {
    const available: Action[] = [
      ...(file.kind === 'image' ? [{ id: 'pdf', title: 'Create PDF', subtitle: 'Use this image and add more if needed', ios: 'doc.richtext', android: 'picture-as-pdf' } as Action] : []),
      { id: 'save', title: 'Save a copy', subtitle: 'Export using your device options', ios: 'square.and.arrow.down', android: 'save-alt' },
      { id: 'info', title: 'File details', subtitle: 'Name, file type and size', ios: 'info.circle', android: 'info-outline' },
    ];
    const source = file.kind === 'image' ? IMAGE_SECTIONS : file.kind === 'video' ? VIDEO_SECTIONS : AUDIO_SECTIONS;
    return [{ title: 'Available actions', data: available }, ...(upcoming ? source.map(section => ({ title: section.title, data: section.tools.filter(tool => tool.id !== 'info' && !(file.kind === 'image' && tool.id === 'pdf')).map(tool => ({ ...tool, unavailable: true } as Action)) })).filter(section => section.data.length) : [])];
  }, [file.kind, upcoming]);
  return <Host colorScheme={mode}><BottomSheet isPresented={visible} onDismiss={onClose} snapPoints={['half', 'full']} showDragIndicator containerColor={colors.systemBackground} contentPadding={{ top: 0, bottom: 0, left: 0, right: 0 }}><RNHostView><View style={styles.sheet}>
    <View style={[styles.header, { borderColor: colors.separator }]}><View style={styles.grow}><ThemedText style={styles.title}>{FILE_LABELS[file.kind]} options</ThemedText><ThemedText numberOfLines={1} style={{ color: colors.secondaryLabel }}>{file.name}</ThemedText></View><Pressable accessibilityRole="button" accessibilityLabel="Close options" onPress={onClose} style={styles.close}><UniversalIcon ios="xmark" android="close" size={24} color={colors.systemBlue} /></Pressable></View>
    <SectionList<Action> sections={sections} keyExtractor={item => item.id} stickySectionHeadersEnabled={false} initialNumToRender={8} maxToRenderPerBatch={6} windowSize={5} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: Math.max(16, insets.bottom) }}
      renderSectionHeader={({ section }) => <ThemedText style={[styles.section, { color: colors.secondaryLabel }]}>{section.title}</ThemedText>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!item.unavailable }} disabled={item.unavailable} onPress={() => onAction(item.id)} style={[styles.row, { borderColor: colors.separator, opacity: item.unavailable ? 0.55 : 1 }]}><View style={[styles.icon, getGradients(colors).module]}><UniversalIcon ios={item.ios} android={item.android} size={22} color={colors.moduleText} /></View><View style={styles.grow}><ThemedText style={styles.label}>{item.title}</ThemedText><ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>{item.unavailable ? 'Coming later' : item.subtitle}</ThemedText></View></Pressable>}
      ListFooterComponent={<Pressable accessibilityRole="button" accessibilityState={{ expanded: upcoming }} onPress={() => setUpcoming(value => !value)} style={styles.more}><ThemedText style={{ color: colors.systemBlue }}>{upcoming ? 'Hide upcoming tools' : 'View upcoming tools'}</ThemedText></Pressable>} />
  </View></RNHostView></BottomSheet></Host>;
}
const styles = StyleSheet.create({ sheet: { flex: 1 }, grow: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth }, title: { fontSize: 20, fontWeight: '600' }, close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }, section: { fontSize: 13, fontWeight: '600', paddingTop: 20, paddingBottom: 8 }, row: { flexDirection: 'row', alignItems: 'center', minHeight: 72, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12 }, icon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' }, label: { fontSize: 16, fontWeight: '500' }, caption: { fontSize: 12, lineHeight: 18 }, more: { minHeight: 56, justifyContent: 'center' } });
