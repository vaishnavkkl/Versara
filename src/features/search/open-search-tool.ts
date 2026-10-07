import { router } from 'expo-router';
import { importRecentFile } from '@/features/files/recent-files';
import { EDITOR_TOOL_TABS } from '@/features/files/media-toolbar';
import { ADVANCED_IMAGE_TOOLS } from '@/features/files/image-tools';
import { createImagePdfToolForFile, discardPdfToolSession, pickPdfTool, type PdfTool } from '@/features/pdf/pdf-tool-session';
import { openPrivacyTool } from '@/features/privacy/open-privacy-tool';
import { getPrivacyTool } from '@/features/privacy/privacy-tools';
import { recordToolUse } from './search-history';
import type { SearchTool } from './search-tools';

/** Asks for a file when the tool needs one, then opens it. Resolves false when the user cancels or the caller went away. */
export async function openSearchTool(tool: SearchTool, current: () => boolean): Promise<boolean> {
  let session: string | null = null;
  try {
    if (tool.module === 'Privacy') {
      const privacyTool = getPrivacyTool(tool.id);
      if (!privacyTool) throw new Error('This privacy tool is unavailable. Please choose another tool.');
      if (!(await openPrivacyTool(privacyTool.id, { current }))) return false;
    } else if (tool.module === 'PDF') {
      session = await pickPdfTool(tool.id as PdfTool, tool.title);
      if (!session) return false;
      if (!current()) { discardPdfToolSession(session); return false; }
      router.push({ pathname: '/pdf-tool', params: { session } });
    } else {
      const file = await importRecentFile('image');
      if (!file || !current()) return false;
      if (tool.id === 'text' || tool.id === 'edit_text') router.push({ pathname: '/image-text', params: { id: file.id, mode: tool.id === 'text' ? 'add' : 'edit' } });
      else if (tool.id === 'pdf') { session = await createImagePdfToolForFile(file); if (!current()) { discardPdfToolSession(session); return false; } router.push({ pathname: '/pdf-tool', params: { session } }); }
      else if (ADVANCED_IMAGE_TOOLS.has(tool.id)) router.push({ pathname: '/image-tool', params: { id: file.id, tool: tool.id } });
      else router.push({ pathname: '/image-editor', params: { id: file.id, tab: EDITOR_TOOL_TABS[tool.id], tool: tool.id } });
    }
    recordToolUse(tool.key);
    return true;
  } catch (cause) {
    if (session) discardPdfToolSession(session);
    throw cause;
  }
}
