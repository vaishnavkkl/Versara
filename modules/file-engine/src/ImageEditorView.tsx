import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';
import FileEngine from './FileEngineModule';

export type ImageCrop = { x: number; y: number; width: number; height: number };
export type ImageEditorProps = ViewProps & {
  source: string;
  /** JSON of rotation, flipH, flipV, brightness, contrast, saturation, warmth and filter. */
  edits: string;
  /** 'none' hides the crop box; 'free' or a ratio such as '4:3' shows it. */
  aspect: string;
  onLoad?: (event: { nativeEvent: { width: number; height: number } }) => void;
  onError?: (event: { nativeEvent: { message: string } }) => void;
  onCropChange?: (event: { nativeEvent: Partial<ImageCrop> }) => void;
};
export const hasNativeImageEditor = !!FileEngine?.nativeImageEditorVersion;
const ImageEditorView = hasNativeImageEditor ? requireNativeView<ImageEditorProps>('FileEngine', 'ImageEditorView') : null;
export default ImageEditorView;
