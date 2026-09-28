import { PDF_SECTIONS, type Method, type MethodSection } from '@/constants/pdf-methods';
import { IMAGE_SECTIONS } from '@/constants/image-methods';
import { advancedPdfTools, implementedPdfTools } from '@/features/pdf/pdf-tool-session';
import { EDITOR_TOOL_TABS } from '@/features/files/media-toolbar';
import { PdfEngine, isPdfEngineAvailable } from '../../../modules/pdf-engine';
import { FileEngine } from '../../../modules/file-engine';
import { hasNativeImageEditor } from '../../../modules/file-engine/src/ImageEditorView';
import { hasNativeEditCanvas } from '../../../modules/pdf-engine/src/PdfEditCanvasView';
import { ADVANCED_IMAGE_TOOLS } from '../files/image-tools';

export type SearchTool = Method & { key: string; module: string; availability: 'ready' | 'build' | 'soon' };
const catalogs: { module: string; sections: readonly MethodSection[] }[] = [
  { module: 'PDF', sections: PDF_SECTIONS }, { module: 'Image', sections: IMAGE_SECTIONS },
];
function availability(module: string, id: string): SearchTool['availability'] {
  if (module === 'PDF' && implementedPdfTools.has(id)) {
    const supported = advancedPdfTools.has(id) ? (PdfEngine?.nativeAdvancedToolsVersion ?? 0) >= (['highlight', 'draw', 'shapes', 'sign', 'numbers'].includes(id) ? 2 : 1) : id === 'viewer' ? isPdfEngineAvailable
      : ['text', 'edit_text', 'remove_text'].includes(id) ? !!PdfEngine?.editPdfText
      : id === 'from_image' ? !!PdfEngine?.imagesToPdf : !!PdfEngine?.organizePdfs;
    return supported ? 'ready' : 'build';
  }
  if (module === 'Image' && id in EDITOR_TOOL_TABS) return hasNativeImageEditor ? 'ready' : 'build';
  if (module === 'Image' && ADVANCED_IMAGE_TOOLS.has(id)) return FileEngine?.nativeImageToolsVersion ? 'ready' : 'build';
  if (module === 'Image' && id === 'pdf') return PdfEngine?.imagesToPdf ? 'ready' : 'build';
  if (module === 'Image' && ['text', 'edit_text'].includes(id)) return FileEngine?.nativeImageTextVersion && hasNativeEditCanvas ? 'ready' : 'build';
  return 'soon';
}
export const SEARCH_TOOLS: SearchTool[] = catalogs.flatMap(({ module, sections }) => {
  const seen = new Set<string>();
  return sections.flatMap(section => section.tools).filter(tool => !seen.has(tool.id) && !!seen.add(tool.id))
    .map(tool => ({ ...tool, module, key: `${module}:${tool.id}`, availability: availability(module, tool.id) }));
});
export const SUGGESTED_TOOLS = ['PDF:edit_text', 'PDF:ocr', 'PDF:remove_text', 'PDF:text', 'Image:crop'];
