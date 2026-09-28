import { router, type Href } from 'expo-router';
import { getRecentFile } from '../files/recent-files';
import { createPdfToolForDocument, discardPdfToolSession } from '../pdf/pdf-tool-session';
import type { PrivacyMode } from './privacy-tools';

/** Privacy shortcuts reuse the same editors and exports as the main tool menus. */
export async function openPrivacyTool(mode: PrivacyMode, options: { replace?: boolean; id?: string; current?: () => boolean } = {}) {
  const navigate = (href: Href) => options.replace ? router.replace(href) : router.push(href);
  if (!options.id) { navigate({ pathname: '/privacy-files', params: { mode } }); return true; }
  const file = await getRecentFile(options.id);
  if (!file || (options.current && !options.current())) return false;
  if (mode === 'scan' || mode === 'pdf_scan') {
    if (file.kind !== (mode === 'pdf_scan' ? 'pdf' : 'image')) throw new Error('Choose the correct file type for this tool.');
    navigate({ pathname: '/privacy-tool', params: { mode, id: file.id } }); return true;
  }
  if (mode === 'remove_text') {
    if (file.kind !== 'pdf') throw new Error('Choose a PDF for this tool.');
    const session = await createPdfToolForDocument('remove_text', 'Remove PDF Text', file);
    if (!session) return false;
    if (options.current && !options.current()) { discardPdfToolSession(session); return false; }
    try { navigate({ pathname: '/pdf-tool', params: { session } }); }
    catch (error) { discardPdfToolSession(session); throw error; }
    return true;
  }
  if (file.kind !== 'image') throw new Error('Choose an image for this tool.');
  navigate({ pathname: '/image-tool', params: { id: file.id, tool: mode } });
  return true;
}
