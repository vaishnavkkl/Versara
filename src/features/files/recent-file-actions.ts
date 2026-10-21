import { Directory, File, Paths } from 'expo-file-system';
import { showDialog } from '@/components/app-dialog';
import { toast } from '@/components/toast';
import { FileEngine } from '../../../modules/file-engine';
import { showActionSheet } from '@/components/action-sheet';
import { formatSize, shareFile, shareNamedFile } from './file-storage';
import { isFileBookmarked, useBookmarks } from './bookmarks';
import { toggleFileBookmarkWithFeedback } from './bookmark-actions';
import { removeRecentFile, type RecentListItem } from './recent-files';

/** "12 Mar 2026, 4:05 PM" in the device locale. */
export function formatWhen(ms: number) {
  const date = new Date(ms);
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

const SHARE_KEEP = 4;
/** Device files are copied next to the app's documents first; only a few recent copies are kept. */
async function shareDevice(item: Extract<RecentListItem, { source: 'device' }>) {
  if (!FileEngine?.importDeviceFile) throw new Error('Install a new development build to share device files.');
  const root = new Directory(Paths.document, 'Versara Share');
  root.create({ intermediates: true, idempotent: true });
  const folders = root.list().filter((entry): entry is Directory => entry instanceof Directory).sort((a, b) => b.name.localeCompare(a.name));
  for (const folder of folders.slice(SHARE_KEEP - 1)) { try { folder.delete(); } catch { /* Retried on the next share. */ } }
  const folder = new Directory(root, `${Date.now()}`);
  folder.create();
  const copy = new File(folder, item.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_'));
  try {
    const imported = await FileEngine.importDeviceFile(item.uri, item.kind, copy.uri);
    await shareFile({ uri: imported.uri, mimeType: imported.mimeType || item.mimeType });
  } catch (cause) { if (folder.exists) folder.delete(); throw cause; }
}

async function share(item: RecentListItem) {
  try {
    if (item.source === 'device') await shareDevice(item);
    else await shareNamedFile({ uri: item.uri, name: item.name, mimeType: item.mimeType, size: item.size });
  } catch (cause) {
    showDialog('Could not share', (cause as Error).message || 'Try again.', undefined, { ios: 'exclamationmark.triangle', android: 'error-outline' });
  }
}

function confirmDelete(item: RecentListItem, onChanged: () => void) {
  const device = item.source === 'device';
  showDialog(device ? 'Delete from this device?' : 'Delete from Versara?',
    device ? `"${item.name}" will be permanently deleted from your device.` : `"${item.name}" will be removed from Versara. Files you saved to your device stay there.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        const work = device
          ? FileEngine?.deleteDeviceFile ? FileEngine.deleteDeviceFile(item.uri) : Promise.reject(new Error('Install a new development build to delete device files.'))
          : removeRecentFile(item);
        void work.then(() => { toast('Deleted'); onChanged(); })
          .catch(cause => showDialog('Could not delete', (cause as Error).message || 'Try again.', undefined, { ios: 'exclamationmark.triangle', android: 'error-outline' }));
      } },
    ], { ios: 'trash', android: 'delete-outline' });
}

/**
 * A recent file's More menu, opened by long press or its More button: open, share, bookmark, details, then delete last.
 * `onChanged` refreshes the list after a delete.
 */
export function showRecentFileActions(item: RecentListItem, onChanged: () => void, onOpen?: () => void) {
  const location = item.source === 'device' ? 'On this device' : 'In Versara';
  const bookmarked = isFileBookmarked(useBookmarks.getState().items, item);
  const pdf = item.kind === 'pdf';
  showActionSheet(item.name, [
    ...(onOpen ? [{ id: 'open', label: pdf ? 'Open PDF' : 'Open image', icon: { ios: 'arrow.up.forward.app' as const, android: 'open-in-new' as const }, onPress: onOpen }] : []),
    { id: 'share', label: 'Share', icon: { ios: 'square.and.arrow.up', android: 'share' }, onPress: () => { void share(item); } },
    ...(pdf || item.kind === 'image' ? [{ id: 'bookmark', label: bookmarked ? 'Remove bookmark' : 'Bookmark', icon: bookmarked ? { ios: 'bookmark.fill' as const, android: 'bookmark' as const } : { ios: 'bookmark' as const, android: 'bookmark-border' as const }, onPress: () => toggleFileBookmarkWithFeedback(item) }] : []),
    { id: 'details', label: 'File details', icon: { ios: 'info.circle', android: 'info-outline' }, onPress: () => showDialog('File details', `${item.name}\n${formatSize(item.size)} · ${pdf ? 'PDF' : item.mimeType}\n${location}\n${formatWhen(item.opened)}`, undefined, { ios: 'info.circle', android: 'info-outline' }) },
    { id: 'delete', label: item.source === 'device' ? 'Delete from device' : 'Delete from Versara', destructive: true, icon: { ios: 'trash', android: 'delete-outline' }, onPress: () => confirmDelete(item, onChanged) },
  ], { subtitle: `${location} · ${formatSize(item.size)}`, icon: pdf ? { ios: 'doc.richtext', android: 'picture-as-pdf' } : { ios: 'photo', android: 'image' } });
}
