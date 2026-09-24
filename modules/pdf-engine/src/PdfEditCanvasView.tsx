import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';
import PdfEngineModule from './PdfEngineModule';

export type PdfEditCanvasProps = ViewProps & {
  source: string;
  /** JSON: preview pixel width/height and the page width in PDF points. */
  pageLayout: string;
  /** JSON array of { id, x, y, width, height } in normalised page coordinates. */
  objects: string;
  selectedId: number;
  adding: boolean;
  disabled: boolean;
  /** JSON { x, y } baseline-left point, or an empty string. */
  placement: string;
  /** JSON { visible, text, font, size, color } for the on-page text field. */
  textBox: string;
  /** JSON array of { erase?, text, font, size, color, x, y } drawn over the page; sizes use `pointWidth` units. */
  annotations?: string;
  /** JSON { x, y, width, height } in normalised page coordinates to zoom to, or an empty string. */
  focus?: string;
  onSelectObject?: (event: { nativeEvent: { id: number } }) => void;
  onPlace?: (event: { nativeEvent: { x: number; y: number } }) => void;
  onTextChange?: (event: { nativeEvent: { text: string } }) => void;
  onSubmitText?: (event: { nativeEvent: { text: string } }) => void;
};
export const hasNativeEditCanvas = !!PdfEngineModule?.nativeEditCanvasVersion;
const PdfEditCanvasView = hasNativeEditCanvas ? requireNativeView<PdfEditCanvasProps>('PdfEngine', 'PdfEditCanvasView') : null;
export default PdfEditCanvasView;
