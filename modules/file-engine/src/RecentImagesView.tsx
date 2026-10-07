import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';
import FileEngine from './FileEngineModule';

export type RecentImagesProps = ViewProps & {
  items: string;
  grid: boolean;
  palette: string;
  disabled: boolean;
  active?: boolean;
  onOpen: (event: { nativeEvent: { id: string } }) => void;
  onRemove: (event: { nativeEvent: { id: string } }) => void;
  onLongPress?: (event: { nativeEvent: { id: string } }) => void;
  /** Version 4: pull to refresh. Set `refreshing` false once the reload finishes. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Version 6: a bookmark button on items with `bookmarkable`, filled when `bookmarked`. */
  onBookmark?: (event: { nativeEvent: { id: string } }) => void;
};
export const hasNativeListBookmarks = (FileEngine?.nativeImageListVersion ?? 0) >= 6;
export const hasNativeImageList = !!FileEngine?.nativeImageListVersion;
export const hasNativeListRefresh = (FileEngine?.nativeImageListVersion ?? 0) >= 4;
/** Version 5 separates cached thumbnails by file revision. */
export const hasNativeThumbnailRevisions = (FileEngine?.nativeImageListVersion ?? 0) >= 5;
/** Version 2 adds video frames and audio artwork. */
export const hasNativeMediaList = (FileEngine?.nativeImageListVersion ?? 0) >= 2;const RecentImagesView = hasNativeImageList ? requireNativeView<RecentImagesProps>('FileEngine') : null;
export default RecentImagesView;
