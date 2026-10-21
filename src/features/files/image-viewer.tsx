import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { AppLoader } from '@/components/app-loader';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { getGradients } from '@/theme/dashboard';
import { ToolActionRow, ToolRowButton } from '@/components/tool-action-row';
import { railSections } from '@/components/tool-rail';
import { ToolSurround } from '@/components/tool-surround';
import { ToolboxSheet } from '@/components/toolbox-sheet';
import { aboveChrome, FocusChrome, useFocusLayout } from '@/components/focus-chrome';
import { useToolRing } from '@/hooks/use-tool-ring';
import { usePublishHeaderActions } from '@/components/header-actions';
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
  /** Lets the screen hide its header while the tool ring supplies its own Close button. */
  onSurroundChange?: (surrounding: boolean) => void;
  /** Tapping the image hides every control; the screen hides its header too. */
  onFocusChange?: (focused: boolean) => void;
};

/**
 * The image preview laid out like the PDF reader: Fit above the image, All tools in the header's More menu, recent tools below,
 * and a Tools button that frames the image with every tool.
 */
export function ImageViewer({ file, revision, busy, active, showImage, landscape, onToggleLandscape, onAction, onClose, changed, onSave, onDiscard, onSurroundChange, onFocusChange }: Props) {
  const colors = usePalette();
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  // The native zoom view has no reset, so Fit remounts it at its fitted size.
  const [fitRevision, setFitRevision] = useState(0);
  const ring = useToolRing(showImage && !focused);
  const recentTools = useSearchHistory(state => state.tools);
  useEffect(hydrateSearchHistory, []);
  const tools = useMemo(() => mediaTools('image'), []);
  const sections = useMemo(() => railSections(tools), [tools]);
  const ringTools = useMemo(() => tools.filter(tool => !tool.soon && !['save', 'share', 'info'].includes(tool.id)), [tools]);
  // The bottom bar shows the image tools used most recently, filled up with the usual quick tools.
  const quickIds = [...new Set([...recentTools.filter(key => key.startsWith('Image:')).map(key => key.slice(6)), ...DEFAULT_QUICK])]
    .filter(id => tools.some(tool => tool.id === id && !tool.soon)).slice(0, 4);
  function perform(id: string) {
    if (id === 'surround') { ring.toggle(); return; }
    onAction(id);
  }
  const toolsButton = { label: 'Tools', accessibilityLabel: 'Show all tools around the image', onPress: ring.toggle };
  const surrounding = ring.active;
  const rails = !surrounding && !focused;
  useEffect(() => { onSurroundChange?.(surrounding); }, [surrounding, onSurroundChange]);
  const imageLayout = useFocusLayout(surrounding);
  useEffect(() => { onFocusChange?.(focused); }, [focused, onFocusChange]);
  // All tools sits first in the header's More menu.
  usePublishHeaderActions(rails && active, [{ id: 'tools', label: 'All tools', ios: 'wrench.and.screwdriver', android: 'mdi:toolbox-outline', selected: toolboxOpen, disabled: busy, onPress: () => { ring.close(); setToolboxOpen(true); } }]);
  const toggleFocus = () => { if (showImage && !surrounding && !toolboxOpen && !busy) setFocused(value => !value); };

  return <Animated.View layout={imageLayout} style={[styles.screen, landscape && styles.row, surrounding && aboveChrome]}>
    {landscape && rails && <FocusChrome edge="side"><MediaToolbar side="left" kind="image" busy={busy} landscape onToggleLandscape={onToggleLandscape} onAction={onAction} /></FocusChrome>}
    <View style={[styles.screen, surrounding && aboveChrome]}>
      {rails && <FocusChrome edge="top"><ToolActionRow left={<>
        <ToolRowButton label="Fit image" icon={{ ios: 'arrow.down.right.and.arrow.up.left', android: 'fit-screen' }} disabled={!showImage} onPress={() => setFitRevision(value => value + 1)} />
      </>} right={changed && <>
        <ToolRowButton label="Discard all changes" icon={{ ios: 'arrow.uturn.backward', android: 'undo' }} disabled={busy} onPress={onDiscard} />
        <Pressable accessibilityRole="button" accessibilityLabel="Save edited image" disabled={busy} onPress={onSave} style={({ pressed }) => [styles.save, getGradients(colors).module, { opacity: busy ? 0.4 : pressed ? 0.7 : 1 }]}>
          {busy ? <AppLoader color={colors.moduleText} /> : <><UniversalIcon ios="square.and.arrow.down" android="save" size={18} color={colors.moduleText} /><ThemedText style={{ color: colors.moduleText, fontWeight: '600' }}>Save</ThemedText></>}
        </Pressable>
      </>} /></FocusChrome>}
      <Animated.View layout={imageLayout} style={[styles.screen, surrounding && aboveChrome]}>
        <ToolSurround active={ring.active && !ring.closing} naming={ring.naming} tools={ringTools} disabled={busy} onAction={perform} onClose={ring.close} onHidden={ring.finishClose}>
          {showImage ? <MediaPreview key={`${file.uri}:${revision ?? ''}:${fitRevision}`} file={file} onClose={onClose} onTap={toggleFocus} /> : <View style={styles.empty}>{active && <AppLoader />}</View>}
        </ToolSurround>
      </Animated.View>
      {focused && <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} style={styles.restore}>
        <Pressable accessibilityRole="button" accessibilityLabel="Exit focus view and show controls" accessibilityHint="Or tap the image" onPress={() => setFocused(false)} style={[styles.restoreButton, { backgroundColor: colors.accentSurface }]}>
          <UniversalIcon ios="arrow.down.right.and.arrow.up.left" android="fullscreen-exit" size={22} color={colors.systemBlue} />
        </Pressable>
      </Animated.View>}
    </View>
    {rails && <FocusChrome edge={landscape ? 'side' : 'bottom'}><MediaToolbar kind="image" busy={busy} landscape={landscape} onToggleLandscape={onToggleLandscape} onAction={onAction} quickIds={quickIds} toolsButton={toolsButton} /></FocusChrome>}
    <ToolboxSheet visible={toolboxOpen && !ring.active && active} title="All tools" subtitle={file.name} sections={sections} footer={<View />} onClose={() => setToolboxOpen(false)} onAction={perform} />
  </Animated.View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0 },
  row: { flexDirection: 'row' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  save: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 6 },
  restore: { position: 'absolute', bottom: 16, right: 16 },
  restoreButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', opacity: 0.9 },
});
