import type { ViewProps } from 'react-native';

export type PdfLoadEvent = { pageCount: number };
export type PdfPageEvent = { page: number; pageCount: number };
export type PdfErrorEvent = { code: string; message: string };
export type PdfEngineViewProps = ViewProps & {
  uri: string;
  page: number;
  pageRevision: number;
  vertical: boolean;
  zoom: number;
  zoomRevision: number;
  dark: boolean;
  onLoad: (event: { nativeEvent: PdfLoadEvent }) => void;
  onPageChange: (event: { nativeEvent: PdfPageEvent }) => void;
  onZoomChange: (event: { nativeEvent: { zoom: number } }) => void;
  onError: (event: { nativeEvent: PdfErrorEvent }) => void;
};
