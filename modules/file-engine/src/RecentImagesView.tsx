import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';
import FileEngine from './FileEngineModule';

export type RecentImagesProps = ViewProps & {
  items: string;
  grid: boolean;
  palette: string;
  disabled: boolean;
  onOpen: (event: { nativeEvent: { id: string } }) => void;
  onRemove: (event: { nativeEvent: { id: string } }) => void;
};
export const hasNativeImageList = !!FileEngine?.nativeImageListVersion;
/** Version 2 adds video frames and audio artwork. */
export const hasNativeMediaList = (FileEngine?.nativeImageListVersion ?? 0) >= 2;
const RecentImagesView = hasNativeImageList ? requireNativeView<RecentImagesProps>('FileEngine') : null;
export default RecentImagesView;
