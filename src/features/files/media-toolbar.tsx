import { IMAGE_SECTIONS } from '@/constants/image-methods';
import { VIDEO_SECTIONS } from '@/constants/video-methods';
import type { Method, MethodSection } from '@/constants/pdf-methods';
import { ToolRail, type RailTool } from '@/components/tool-rail';
import { hasNativeImageEditor } from '../../../modules/file-engine/src/ImageEditorView';
import { FileEngine } from '../../../modules/file-engine';
import { hasNativeEditCanvas } from '../../../modules/pdf-engine/src/PdfEditCanvasView';
import type { EditorTab } from './image-editor';

type Tool = RailTool;
type Kind = 'image' | 'video';

/** Image tools that open the native editor on the matching tab. */
export const EDITOR_TOOL_TABS: Record<string, EditorTab> = {
  crop: 'crop', rotate: 'rotate', flip_h: 'rotate', flip_v: 'rotate',
  brightness: 'adjust', contrast: 'adjust', saturation: 'adjust', temperature: 'adjust',
  filters: 'filters', resize: 'resize', compress: 'export', convert: 'export', metadata: 'export',
};
const editorTools: Tool[] = hasNativeImageEditor ? IMAGE_SECTIONS.flatMap(section => section.tools as readonly Method[])
  .filter(tool => tool.id in EDITOR_TOOL_TABS)
  .map(tool => ({ id: tool.id, title: tool.title.replace(/ Image$/, ''), ios: tool.ios, android: tool.android })) : [];

const textTool: Tool[] = FileEngine?.nativeImageTextVersion && hasNativeEditCanvas ? [
  { id: 'edit_text', title: 'Edit text', ios: 'character.cursor.ibeam', android: 'edit-note' },
  { id: 'text', title: 'Add text', ios: 'textformat', android: 'text-fields' },
] : [];

const AVAILABLE: Record<Kind, Tool[]> = {
  image: [
    ...textTool,
    ...editorTools,
    { id: 'pdf', title: 'Create PDF', ios: 'doc.richtext', android: 'picture-as-pdf' },
    { id: 'save', title: 'Save to device', ios: 'square.and.arrow.down', android: 'save-alt' },
    { id: 'share', title: 'Share', ios: 'square.and.arrow.up', android: 'share' },
    { id: 'info', title: 'Details', ios: 'info.circle', android: 'info-outline' },
  ],
  video: [
    { id: 'save', title: 'Save to device', ios: 'square.and.arrow.down', android: 'save-alt' },
    { id: 'share', title: 'Share', ios: 'square.and.arrow.up', android: 'share' },
    { id: 'info', title: 'Details', ios: 'info.circle', android: 'info-outline' },
  ],
};
function upcoming(kind: Kind, sections: readonly MethodSection[]): Tool[] {
  return sections.flatMap(section => section.tools)
    .filter(tool => !AVAILABLE[kind].some(item => item.id === tool.id))
    .map(tool => ({ id: tool.id, title: tool.title.replace(/ (Image|Video)$/, ''), ios: tool.ios, android: tool.android, soon: true }));
}
const TOOLS: Record<Kind, Tool[]> = {
  image: [...AVAILABLE.image, ...upcoming('image', IMAGE_SECTIONS)],
  video: [...AVAILABLE.video, ...upcoming('video', VIDEO_SECTIONS)],
};

type Props = { kind: Kind; busy: boolean; landscape: boolean; onToggleLandscape: () => void; onAction: (id: string) => void };

/** Bottom tool row in portrait; a side rail in landscape so the preview keeps its height. */
export function MediaToolbar({ kind, busy, landscape, onToggleLandscape, onAction }: Props) {
  const tools: RailTool[] = [
    { id: 'orientation', title: landscape ? 'Portrait' : 'Landscape', ios: landscape ? 'rectangle.portrait' : 'rectangle', android: 'screen-rotation', highlighted: true, accessibilityLabel: `Switch to ${landscape ? 'portrait' : 'landscape'} view` },
    ...TOOLS[kind],
  ];
  return <ToolRail tools={tools} busyId={busy ? 'pdf' : null} disabled={busy} landscape={landscape}
    onAction={id => { if (id === 'orientation') onToggleLandscape(); else onAction(id); }} />;
}
