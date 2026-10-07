import { showDialog } from '@/components/app-dialog';
import { toast } from '@/components/toast';
import { bookmarkedPageCount, toggleFileBookmark, useBookmarks, isFileBookmarked } from './bookmarks';

/** Bookmarks a file, or removes its bookmarks after confirming when that also clears bookmarked PDF pages. */
export function toggleFileBookmarkWithFeedback(file: { kind: string; name: string }) {
  const pages = bookmarkedPageCount(file);
  if (isFileBookmarked(useBookmarks.getState().items, file) && pages > 0) {
    showDialog('Remove bookmarks?', `${file.name} has ${pages} bookmarked ${pages === 1 ? 'page' : 'pages'}. They will be removed too.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { toggleFileBookmark(file); toast('Bookmarks removed'); } },
    ], { ios: 'bookmark', android: 'bookmark-border' });
    return;
  }
  toast(toggleFileBookmark(file) ? 'Bookmarked · see Bookmarked in Files' : 'Bookmark removed');
}
