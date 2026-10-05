import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppLoader } from '@/components/app-loader';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { getGradients } from '@/theme/dashboard';
import { ToolActionRow, ToolRowButton } from '@/components/tool-action-row';
import { railSections } from '@/components/tool-rail';
import { ToolSurround, ToolSurroundCloseButton } from '@/components/tool-surround';
import { HelpButton } from '@/components/help-button';
import { ToolboxSheet } from '@/components/toolbox-sheet';
import { useToolRing } from '@/hooks/use-tool-ring';
import { hydrateSearchHistory, useSearchHistory } from '../search/search-history';
import { MediaPreview } from './media-preview';
import { MediaToolbar, mediaTools } from './media-toolbar';
import type { RecentFile } from './recent-files';

const DEFAULT_QUICK = ['edit_text', 'text', 'crop', 'filters'];

type Props = {
  file: RecentFile; revision?: string; busy: boolean; active: boolean; showImage: boolean;
  landscape: boolean; onToggleLandscape: () => void; onAction: (id: string) => void; onClose: () => void;
  /** Tools have applied changes that are not saved yet. */
  changed: boolean; onSave: () => void; onDiscard: () => void;
  /** Lets the screen hide its header while tools surround the image; help and close then sit in the action row. */
  onSurroundChange?: (surrounding: boolean) => void;
};

/**
 * The image preview laid out like the PDF reader: Fit and All tools above the image, recent tools below,
 * and a Tools button that frames the image with every tool.
 */
export function ImageViewer({ file, revision, busy, active, showImage, landscape, onToggleLandscape, onAction, onClose, changed, onSave, onDiscard, onSurroundChange }: Props) {
  const colors = usePalette();
  const [toolboxOpen, setToolboxOpen] = useState(false);
  // The native zoom view has no reset, so Fit remounts it at its fitted size.
  const [fitRevision, setFitRevision] = useState(0);
  const ring = useToolRing(showImage);
  const recentTools = useSearchHistory(state => state.tools);
  useEffect(hydrateSearchHistory, []);
  const tools = useMemo(() => mediaTools('image'), []);
  const sections = useMemo(() => railSections(tools), [tools]);
  const ringTools = useMemo(() => tools.filter(tool => !tool.soon), [tools]);
  // The bottom bar shows the image tools used most recently, filled up with the usual quick tools.
  const quickIds = [...new Set([...recentTools.filter(key => key.startsWith('Image:')).map(key => key.slice(6)), ...DEFAULT_QUICK])]
    .filter(id => tools.some(tool => tool.id === id && !tool.soon)).slice(0, 4);
  function perform(id: string) {
    if (id === 'surround') { ring.toggle(); return; }
    onAction(id);
  }
  const toolsButton = { label: 'Tools', accessibilityLabel: 'Show all tools around the image', onPress: ring.toggle };
  const rails = !ring.active;
  const surrounding = ring.active;
  useEffect(() => { onSurroundChange?.(surrounding); }, [surrounding, onSurroundChange]);

  return <View style={[styles.screen, landscape && styles.row]}>
    {landscape && rails && <MediaToolbar side="left" kind="image" busy={busy} landscape onToggleLandscape={onToggleLandscape} onAction={onAction} />}
    <View style={styles.screen}>
      <ToolActionRow left={<>
        <ToolRowButton label="Fit image" icon={{ ios: 'arrow.down.right.and.arrow.up.left', android: 'fit-screen' }} disabled={!showImage} onPress={() => setFitRevision(value => value + 1)} />
        <ToolRowButton label="All tools" icon={{ ios: 'square.grid.2x2', android: 'grid-view' }} expanded={toolboxOpen} disabled={busy} onPress={() => { ring.close(); setToolboxOpen(true); }} />
      </>} right={(changed || surrounding) && <>
        {changed && <>
        <ToolRowButton label="Discard all changes" icon={{ ios: 'arrow.uturn.backward', android: 'undo' }} disabled={busy} onPress={onDiscard} />
        <Pressable accessibilityRole="button" accessibilityLabel="Save edited image" disabled={busy} onPress={onSave} style={({ pressed }) => [styles.save, getGradients(colors).module, { opacity: busy ? 0.4 : pressed ? 0.7 : 1 }]}>
          {busy ? <AppLoader color={colors.moduleText} /> : <><UniversalIcon ios="square.and.arrow.down" android="save" size={18} color={colors.moduleText} /><ThemedText style={{ color: colors.moduleText, fontWeight: '600' }}>Save</ThemedText></>}
        </Pressable>
        </>}
        {surrounding && <>{onSurroundChange && <HelpButton />}<ToolSurroundCloseButton compact disabled={ring.closing} onPress={ring.close} /></>}
      </>} />
      <ToolSurround active={ring.active && !ring.closing} naming={ring.naming} tools={ringTools} disabled={busy} showClose={false} onAction={perform} onClose={ring.close} onHidden={ring.finishClose}>
        {showImage ? <MediaPreview key={`${file.uri}:${revision ?? ''}:${fitRevision}`} file={file} onClose={onClose} /> : <View style={styles.empty}>{active && <AppLoader />}</View>}
      </ToolSurround>
    </View>
    {rails && <MediaToolbar kind="image" busy={busy} landscape={landscape} onToggleLandscape={onToggleLandscape} onAction={onAction} quickIds={quickIds} toolsButton={toolsButton} />}
    <ToolboxSheet visible={toolboxOpen && !ring.active && active} title="All tools" subtitle={file.name} sections={sections} footer={<View />} onClose={() => setToolboxOpen(false)} onAction={perform} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0 },
  row: { flexDirection: 'row' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  save: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 6 },
});
