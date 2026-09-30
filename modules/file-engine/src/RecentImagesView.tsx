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
};
export const hasNativeImageList = !!FileEngine?.nativeImageListVersion;
/** Version 2 adds video frames and audio artwork. */
export const hasNativeMediaList = (FileEngine?.nativeImageListVersion ?? 0) >= 2;
/** Version 3 adds DOCX and TXT first-page previews and long press. */
export const hasNativeDocumentList = (FileEngine?.nativeImageListVersion ?? 0) >= 3;
const RecentImagesView = hasNativeImageList ? requireNativeView<RecentImagesProps>('FileEngine') : null;
export default RecentImagesView;
