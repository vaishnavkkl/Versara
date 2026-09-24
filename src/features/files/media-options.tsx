import { useMemo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { ToolboxSheet } from '@/components/toolbox-sheet';
import { IMAGE_SECTIONS } from '@/constants/image-methods';
import { VIDEO_SECTIONS } from '@/constants/video-methods';
import { AUDIO_SECTIONS } from '@/constants/audio-methods';
import type { Method } from '@/constants/pdf-methods';
import { ThemedText } from '@/components/themed-text';
import { usePalette } from '@/theme/colors';
import { typography as t } from '@/theme/dashboard';
import { FILE_LABELS, type RecentFile } from './recent-files';

type Action = Method & { unavailable?: boolean };
export function MediaOptions({ file, visible, onClose, onAction }: { file: RecentFile; visible: boolean; onClose: () => void; onAction: (id: string) => void }) {
  const colors = usePalette();
  const [upcoming, setUpcoming] = useState(false);
  const sections = useMemo(() => {
    const available: Action[] = [
      ...(file.kind === 'image' ? [{ id: 'pdf', title: 'Create PDF', subtitle: 'Use this image and add more if needed', ios: 'doc.richtext', android: 'picture-as-pdf' } as Action] : []),
      { id: 'save', title: 'Save to device', subtitle: 'Keep a copy in your device folders', ios: 'square.and.arrow.down', android: 'save-alt' },
      { id: 'share', title: 'Share', subtitle: 'Send with another app', ios: 'square.and.arrow.up', android: 'share' },
      { id: 'info', title: 'File details', subtitle: 'Name, file type and size', ios: 'info.circle', android: 'info-outline' },
    ];
    const source = file.kind === 'image' ? IMAGE_SECTIONS : file.kind === 'video' ? VIDEO_SECTIONS : AUDIO_SECTIONS;
    return [{ title: 'Available actions', data: available }, ...(upcoming ? source.map(section => ({ title: section.title, data: section.tools.filter(tool => tool.id !== 'info' && !(file.kind === 'image' && tool.id === 'pdf')).map(tool => ({ ...tool, unavailable: true } as Action)) })).filter(section => section.data.length) : [])];
  }, [file.kind, upcoming]);
  return <ToolboxSheet visible={visible} title={`${FILE_LABELS[file.kind]} toolbox`} subtitle={file.name} sections={sections} onClose={onClose} onAction={onAction}
    footer={<Pressable accessibilityRole="button" accessibilityState={{ expanded: upcoming }} onPress={() => setUpcoming(value => !value)} style={styles.more}><ThemedText style={[styles.body, { color: colors.systemBlue }]}>{upcoming ? 'Hide upcoming tools' : 'View upcoming tools'}</ThemedText></Pressable>} />;
}
const styles = StyleSheet.create({
  body: { ...t.body },
  more: { minHeight: 56, justifyContent: 'center' },
});
