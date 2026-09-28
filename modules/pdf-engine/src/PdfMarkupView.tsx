import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';
import PdfEngine from './PdfEngineModule';

export type PdfMark = { id?: string; imageUri?: string; pixelPath?: string; originalImageUri?: string; originalPixelPath?: string; cleanImageUri?: string; cleanPixelPath?: string; backgroundRemoved?: boolean; page: number; kind: string; color: string; fillColor?: string; width: number; opacity?: number; pattern?: string; brush?: string; points: [number, number][] };
export type PdfMarkChange = PdfMark | { id: string; deleted: true };
export type PdfMarkEvent = { nativeEvent: { mark: string } };
type Props = ViewProps & { source: string; marks: string; mode: string; inkColor: string; fillColor: string; shapePath: string; inkWidth: number; inkOpacity?: number; brush?: string; pattern?: string; disabled: boolean; onMark: (event: PdfMarkEvent) => void; onSelection?: (event: PdfMarkEvent) => void };
export default (PdfEngine?.nativeAdvancedToolsVersion ?? 0) >= 2 ? requireNativeView<Props>('PdfEngine', 'PdfMarkupView') : null;
