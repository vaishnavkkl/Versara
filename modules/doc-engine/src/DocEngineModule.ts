import { NativeModule, requireOptionalNativeModule } from 'expo';

export type BandAlign = 'left' | 'center' | 'right';
export type HeaderFooter = {
  header: string;
  headerAlign: BandAlign;
  headerLocked?: boolean;
  footer: string;
  footerAlign: BandAlign;
  footerLocked?: boolean;
  pagePos: 'none' | 'header' | 'footer';
  pageAlign: BandAlign;
  pageFormat: 'plain' | 'page' | 'pageOf';
};
/** Paper size and margins in twips (1/1440 inch). */
export type PageSetup = { w: number; h: number; top: number; right: number; bottom: number; left: number };
export type DocReady = { characters: number; sections: number; section: number; locked: number; restored: boolean; hf?: string; page?: string };
/** `page` is the JSON page setup, sent when the margins change from the ruler. */
export type DocChange = { dirty: boolean; characters: number; canUndo: boolean; canRedo: boolean; section: number; sections: number; page?: string };
export type DocFormat = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  align: 'left' | 'center' | 'right' | 'justify';
  list: 'none' | 'bullet' | 'decimal';
  size: number;
  image: boolean;
  /** Left indent in twips. */
  indent?: number;
  /** First-line indent in twips relative to the left indent; negative for a hanging indent. */
  first?: number;
  /** Line spacing in 240ths of a line; 0 keeps the document's own. */
  line?: number;
  /** Space before and after in twips; -1 keeps the document's own. */
  before?: number;
  after?: number;
};
declare class DocEngine extends NativeModule {
  /** DOCX open, edit and save. Older builds leave this unset; 2 adds headers, footers and page numbers; 3 adds page setup, spacing, ruler and page strip. */
  readonly nativeDocEditorVersion?: number;
  command(name: string, value: string): Promise<void>;
  insertImage(path: string): Promise<void>;
  resizeImage(percent: number): Promise<void>;
  setHeaderFooter(value: string): Promise<void>;
  setPage(value: string): Promise<void>;
  setSection(index: number): Promise<void>;
  save(output: string): Promise<void>;
  /** Uses the document's page setup; builds before version 3 take a paper size instead. */
  exportPdf(output: string, pageSize?: 'a4' | 'letter'): Promise<void>;
  exportText(output: string): Promise<void>;
  discard(): void;
}
export default requireOptionalNativeModule<DocEngine>('DocEngine');
