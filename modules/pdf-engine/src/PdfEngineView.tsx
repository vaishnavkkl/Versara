import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import type { PdfEngineViewProps } from './PdfEngine.types';
import PdfEngineModule from './PdfEngineModule';

const NativeView = PdfEngineModule ? requireNativeView<PdfEngineViewProps>('PdfEngine') : null;
export const isPdfEngineAvailable = NativeView !== null;
export default function PdfEngineView(props: PdfEngineViewProps) {
  const View = NativeView as ComponentType<PdfEngineViewProps> | null;
  return View ? <View {...props} /> : null;
}
