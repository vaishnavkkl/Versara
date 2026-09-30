import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import DocEngine, { type DocChange, type DocFormat, type DocReady } from './DocEngineModule';

export type DocEditorProps = {
  style?: StyleProp<ViewStyle>;
  source?: string;
  format?: 'docx' | 'txt';
  blank?: boolean;
  dark?: boolean;
  /** Shows the horizontal ruler above the page. */
  ruler?: boolean;
  /** Shows page thumbnails with previous and next controls below the page. */
  pages?: boolean;
  onReady?: (event: { nativeEvent: DocReady }) => void;
  onDocChange?: (event: { nativeEvent: DocChange }) => void;
  onError?: (event: { nativeEvent: { message: string } }) => void;
  onFormat?: (event: { nativeEvent: DocFormat }) => void;
  onBand?: (event: { nativeEvent: { kind: 'header' | 'footer' } }) => void;
};
const NativeView = DocEngine ? requireNativeView<DocEditorProps>('DocEngine') : null;
export const isDocEditorAvailable = !!DocEngine?.nativeDocEditorVersion;
export const hasHeaderFooter = (DocEngine?.nativeDocEditorVersion ?? 0) >= 2;
export const hasPageSetup = (DocEngine?.nativeDocEditorVersion ?? 0) >= 3;
export default function DocEditorView(props: DocEditorProps) {
  const View = NativeView as ComponentType<DocEditorProps> | null;
  return View ? <View {...props} /> : null;
}
