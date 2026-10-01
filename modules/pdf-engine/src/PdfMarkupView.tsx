import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';
import PdfEngine from './PdfEngineModule';

export type PdfMark = { id?: string; imageUri?: string; pixelPath?: string; originalImageUri?: string; originalPixelPath?: string; cleanImageUri?: string; cleanPixelPath?: string; backgroundRemoved?: boolean; signatureId?: string; page: number; kind: string; color: string; fillColor?: string; width: number; opacity?: number; pattern?: string; brush?: string; points: [number, number][] };
export type PdfMarkChange = PdfMark | { id: string; deleted: true };
export type PdfMarkEvent = { nativeEvent: { mark: string } };
type Props = ViewProps & { source: string; marks: string; mode: string; inkColor: string; fillColor: string; shapePath: string; inkWidth: number; inkOpacity?: number; brush?: string; pattern?: string; disabled: boolean; onMark: (event: PdfMarkEvent) => void; onSelection?: (event: PdfMarkEvent) => void;
  /** `serial:factor`; each new serial zooms by factor around the selected mark, or the view centre. */
  zoomRequest?: string; onZoom?: (event: { nativeEvent: { zoom: number } }) => void;
  /** Select mode: a sideways swipe on empty page space at fit zoom. 1 is the next page, -1 the previous. */
  onPageSwipe?: (event: { nativeEvent: { direction: number } }) => void };
export default (PdfEngine?.nativeAdvancedToolsVersion ?? 0) >= 2 ? requireNativeView<Props>('PdfEngine', 'PdfMarkupView') : null;
