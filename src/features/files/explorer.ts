import { router } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import { FileEngine, type ExplorerEntry, type ExplorerKind } from '../../../modules/file-engine';
import { openPdfScreen } from '@/features/pdf/open-pdf-screen';
import { importDeviceRecent } from './recent-files';
import { shareFile } from './file-storage';
import type { UniversalIcon } from '@/components/universal-icon';

export const explorerAvailable = () => !!FileEngine?.nativeExplorerVersion;

type Icon = React.ComponentProps<typeof UniversalIcon>;
type Glyph = { ios: Icon['ios']; android: Icon['android']; tint: readonly [string, string] };
export const KIND_GLYPHS: Record<ExplorerKind, Glyph> = {
  folder: { ios: 'folder.fill', android: 'folder', tint: ['#F5A524', '#FFD166'] },
  pdf: { ios: 'doc.richtext', android: 'picture-as-pdf', tint: ['#E5484D', '#FF9466'] },
  image: { ios: 'photo.fill', android: 'image', tint: ['#1FA971', '#6EE7A8'] },
  video: { ios: 'play.rectangle.fill', android: 'smart-display', tint: ['#7C3AED', '#C084FC'] },
  audio: { ios: 'waveform', android: 'graphic-eq', tint: ['#F76B15', '#FFB547'] },
  archive: { ios: 'archivebox.fill', android: 'archive', tint: ['#8D6E63', '#BCAAA4'] },
  document: { ios: 'doc.text.fill', android: 'description', tint: ['#0A84FF', '#5AC8FA'] },
  app: { ios: 'app.badge', android: 'android', tint: ['#34A853', '#8BD99B'] },
  other: { ios: 'doc.fill', android: 'insert-drive-file', tint: ['#6B7280', '#A1A1AA'] },
};

let opening = false;
/** Routes a device file to the matching Versara viewer; other types go to the system share sheet. */
export async function openExplorerEntry(entry: ExplorerEntry) {
  if (opening) return;
  opening = true;
  try {
    if (entry.kind === 'pdf') { openPdfScreen({ uri: entry.uri, name: entry.name }); return; }
    if (entry.kind === 'image' || entry.kind === 'video' || entry.kind === 'audio') {
      const file = await importDeviceRecent({ id: entry.path, uri: entry.uri, name: entry.name, mimeType: entry.mimeType, size: entry.size, modified: entry.modified, kind: entry.kind, source: 'device', opened: Date.now() });
      router.push({ pathname: '/file-preview', params: { id: file.id } });
      return;
    }
    // Share targets need an app-owned copy; external paths are not exposed through the share provider.
    const copy = new File(Paths.cache, `share-${Date.now()}-${entry.name}`);
    new File(entry.uri).copy(copy);
    await shareFile({ uri: copy.uri, mimeType: entry.mimeType || undefined });
  } finally {
    opening = false;
  }
}

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const formatDate = (value: number) => dateFormat.format(new Date(value));
