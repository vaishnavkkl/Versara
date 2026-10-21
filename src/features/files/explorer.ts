import { Platform } from 'react-native';
import { router } from 'expo-router';
import { FileEngine, type ExplorerEntry, type ExplorerKind } from '../../../modules/file-engine';
import { openPdfScreen } from '@/features/pdf/open-pdf-screen';
import { importDeviceRecent } from './recent-files';
import { toast } from '@/components/toast';
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

// Formats the platform image decoder opens; Android cannot decode TIFF.
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif', ...(Platform.OS === 'ios' ? ['tif', 'tiff'] : [])]);

/** The file manager lists folders, PDFs and images Versara can open; everything else stays hidden. */
export function isSupportedEntry(entry: ExplorerEntry) {
  if (entry.directory) return !entry.name.startsWith('.');
  if (entry.kind === 'pdf') return true;
  if (entry.kind !== 'image') return false;
  const extension = /\.([a-z0-9]+)$/i.exec(entry.name)?.[1]?.toLowerCase();
  return extension ? IMAGE_EXTENSIONS.has(extension) : entry.mimeType.startsWith('image/');
}

let opening = false;
/** Routes a device file to the matching Versara viewer; other types show that they aren't supported. */
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
    toast(`${entry.name} isn't supported in Versara yet.`);
  } finally {
    opening = false;
  }
}

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const formatDate = (value: number) => dateFormat.format(new Date(value));
