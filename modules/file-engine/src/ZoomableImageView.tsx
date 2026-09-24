import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';
import FileEngine from './FileEngineModule';

export type ZoomableImageProps = ViewProps & {
  source: string;
  onLoad?: (event: { nativeEvent: { width: number; height: number } }) => void;
  onError?: (event: { nativeEvent: { message: string } }) => void;
  onDismiss?: () => void;
};
export const hasNativeZoomImage = !!FileEngine?.nativeZoomImageVersion;
const ZoomableImageView = hasNativeZoomImage ? requireNativeView<ZoomableImageProps>('FileEngine', 'ZoomableImageView') : null;
export default ZoomableImageView;
