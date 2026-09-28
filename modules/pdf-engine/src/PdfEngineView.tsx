import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import type { PdfEngineViewProps } from './PdfEngine.types';
import PdfEngineModule from './PdfEngineModule';

// PdfEngine exports several views. The default follows native declaration order,
// so always select the reader explicitly rather than accidentally mounting a canvas.
const NativeView = PdfEngineModule ? requireNativeView<PdfEngineViewProps>('PdfEngine', 'PdfEngineView') : null;
export const isPdfEngineAvailable = NativeView !== null;
export default function PdfEngineView(props: PdfEngineViewProps) {
  const View = NativeView as ComponentType<PdfEngineViewProps> | null;
  return View ? <View {...props} /> : null;
}
