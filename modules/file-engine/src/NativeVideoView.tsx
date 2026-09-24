import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';
import FileEngine from './FileEngineModule';

export type NativeVideoProps = ViewProps & {
  source: string;
  palette: string;
  onLoad?: (event: { nativeEvent: { duration: number; width: number; height: number } }) => void;
  onError?: (event: { nativeEvent: { message: string } }) => void;
};
export const hasNativeVideo = !!FileEngine?.nativeVideoVersion;
const NativeVideoView = hasNativeVideo ? requireNativeView<NativeVideoProps>('FileEngine', 'NativeVideoView') : null;
export default NativeVideoView;
