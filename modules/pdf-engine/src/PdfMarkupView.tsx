import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';
import PdfEngine from './PdfEngineModule';

export type PdfMark = { id?: string; page: number; kind: string; color: string; fillColor?: string; width: number; pattern?: string; brush?: string; points: [number, number][] };
type Props = ViewProps & { source: string; marks: string; mode: string; inkColor: string; fillColor: string; shapePath: string; inkWidth: number; brush?: string; pattern?: string; disabled: boolean; onMark: (event: { nativeEvent: { mark: string } }) => void };
export default (PdfEngine?.nativeAdvancedToolsVersion ?? 0) >= 2 ? requireNativeView<Props>('PdfEngine', 'PdfMarkupView') : null;
