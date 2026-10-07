import type { ViewProps } from 'react-native';

export type PdfLoadEvent = { pageCount: number };
export type PdfPageEvent = { page: number; pageCount: number };
export type PdfErrorEvent = { code: string; message: string };
export type PdfEngineViewProps = ViewProps & {
  uri: string;
  /** Opening password for a protected PDF. A wrong or missing one reports PDF_PASSWORD_INCORRECT or PDF_PASSWORD_REQUIRED. */
  password?: string;
  page: number;
  pageRevision: number;
  vertical: boolean;
  zoom: number;
  zoomRevision: number;
  dark: boolean;
  searchHighlights?: string;
  /** Scrolling stays free, but pages other than the current one are dimmed and blurred. */
  focusCurrent?: boolean;
  onLoad: (event: { nativeEvent: PdfLoadEvent }) => void;
  onPageChange: (event: { nativeEvent: PdfPageEvent }) => void;
  onZoomChange: (event: { nativeEvent: { zoom: number } }) => void;
  onError: (event: { nativeEvent: PdfErrorEvent }) => void;
  /** Two pages side by side. `page` and page events still use the first page of a spread. */
  twoPage?: boolean;
  /** Right-to-left reading order for spreads and single-page swipes. */
  rightToLeft?: boolean;
  /** A single tap on the page, after double-tap zoom is ruled out. */
  onTap?: () => void;
};
