import { NativeModule, requireOptionalNativeModule } from 'expo';

export type ConversionProgress = { jobId: string; completed: number; total: number };
export type ImagePdfOptions = { jobId: string; uris: string[]; outputUri: string; pageSize: 'a4' | 'letter' | 'image' };
export type PdfResult = { uri: string; pageCount: number; size: number };
export type PdfRange = { start: number; end: number };
export type PdfRotation = { page: number; degrees: number };
export type PdfOrganizeOptions = { jobId: string; operation: 'merge' | 'split' | 'extract' | 'delete' | 'reorder' | 'rotate'; uris: string[]; outputUris: string[]; ranges: PdfRange[]; pages?: number[]; rotations?: PdfRotation[] };
declare class PdfEngine extends NativeModule<{ onConversionProgress: (event: ConversionProgress) => void }> {
  renderFileThumbnail(jobId: string, uri: string, kind: string, page: number, outputUri: string): Promise<string>;
  cancelThumbnail(jobId: string): void;
  editPdfText(jobId: string, request: string): Promise<string>;
  cancelTextEdit(jobId: string): void;
  imagesToPdf(options: ImagePdfOptions): Promise<PdfResult>;
  cancelConversion(jobId: string): void;
  inspectPdfs(jobId: string, uris: string[]): Promise<{ uri: string; pageCount: number }[]>;
  organizePdfs(options: PdfOrganizeOptions): Promise<PdfResult[]>;
  cancelPdfJob(jobId: string): void;
}
export default requireOptionalNativeModule<PdfEngine>('PdfEngine');
