import { Directory, File } from 'expo-file-system';
import { PdfEngine } from '../../../modules/pdf-engine';
import type { PdfTextObject } from './pdf-edit-canvas';

export type PagePreview = { imageUri: string; width: number; height: number; pageCount: number; objects: PdfTextObject[]; nestedForms: number };
type Request = { uri: string; page: number; edits: string; generation: number; resolve: (preview: PagePreview | null) => void; reject: (error: unknown) => void };

/** One native page render at a time, with only the newest request allowed to publish. */
export class PdfPreviewQueue {
  private generation = 0;
  private activeId: string | null = null;
  private pending: Promise<void> = Promise.resolve();
  private cached: { key: string; preview: PagePreview } | null = null;
  private running = false;
  private next: Request | null = null;

  constructor(private directory: Directory) {}

  cancel() {
    this.generation++;
    this.next?.resolve(null);
    this.next = null;
    if (this.activeId) PdfEngine?.cancelTextEdit(this.activeId);
  }

  settle() { return this.pending; }

  render(uri: string, page: number, edits: string): Promise<PagePreview | null> {
    return new Promise((resolve, reject) => {
      // Replace the waiting request rather than accumulating a Promise chain of
      // obsolete edit payloads while a difficult native page is still rendering.
      this.next?.resolve(null);
      this.next = { uri, page, edits, generation: this.generation, resolve, reject };
      if (!this.running) {
        this.running = true;
        this.pending = this.drain();
      }
    });
  }

  private async drain() {
    try {
      while (this.next) {
        const request = this.next;
        this.next = null;
        try { request.resolve(await this.execute(request)); }
        catch (error) { request.reject(error); }
      }
    } finally { this.running = false; }
  }

  private async execute({ uri, page, edits, generation }: Request): Promise<PagePreview | null> {
    const key = JSON.stringify([uri, page, edits]);
    if (generation !== this.generation) return null;
    if (this.cached?.key === key) return this.cached.preview;
    if (!PdfEngine) throw new Error('Install a new development build to use the editor.');
    const id = `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const image = new File(this.directory, `${id}.png`);
    this.activeId = id;
    let keep = false;
    try {
      const preview: PagePreview = JSON.parse(await PdfEngine.editPdfText(id, JSON.stringify({ action: 'preview', uri, page, edits: JSON.parse(edits), imageUri: image.uri })));
      if (generation !== this.generation) return null;
      this.cached = { key, preview };
      keep = true;
      return preview;
    } catch (cause) {
      if (generation !== this.generation) return null;
      throw cause;
    } finally {
      this.activeId = null;
      if (!keep) try { if (image.exists) image.delete(); } catch { /* Session cleanup retries. */ }
    }
  }
}
