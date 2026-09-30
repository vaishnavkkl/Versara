import { useCallback, useState, type ReactNode } from 'react';
import { AppState, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Constants from 'expo-constants';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { AppearanceButtons } from '@/components/appearance-buttons';
import { LayoutToggle } from '@/components/layout-toggle';
import { showDialog } from '@/components/app-dialog';
import { toast } from '@/components/toast';
import { useAppearance, usePalette } from '@/theme/colors';
import { Host, Switch } from '@expo/ui';
import { useReducedMotion } from 'react-native-reanimated';
import { toolColors } from '@/theme/tool-colors';
import { brandFont, spacing as s, typography as t } from '@/theme/dashboard';
import { getFileAccessStatus, isFileEngineAvailable, requestFileAccess, type FileAccessStatus } from '@/features/files/file-access';
import { clearRecentFiles } from '@/features/files/recent-files';
import { formatSize } from '@/features/files/file-storage';
import { FileEngine } from '../../../../modules/file-engine';
import { clearUnusedThumbnails, unusedThumbnailBytes } from '@/features/files/thumbnail-cache';
import { clearSearchHistory, hydrateSearchHistory, setSearchHistoryEnabled, useSearchHistory } from '@/features/search/search-history';

type Icon = React.ComponentProps<typeof UniversalIcon>;
const VERSION = Constants.expoConfig?.version ?? '1.0.0';
const LICENSES = 'Versara is built with free and open-source software, including:\n\n• PDFium (BSD-3-Clause / Apache-2.0)\n• React Native (MIT)\n• Expo SDK (MIT)\n• React Native Reanimated (MIT)\n• Sora typeface (SIL Open Font License)\n• Material Icons (Apache-2.0)';
const PRIVACY = 'Versara works offline. PDFs, documents and images are processed on this device and are never uploaded.\n\nThere is no account, no analytics and no ads. Your preferences are stored only on this phone.';

function cacheBytes() {
  try { return unusedThumbnailBytes(); } catch { return 0; }
}

export default function SettingsScreen() {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const reducedMotion = useReducedMotion();
  const [media, setMedia] = useState<FileAccessStatus>('unavailable');
  const [allFiles, setAllFiles] = useState<boolean | null>(null);
  const [cache, setCache] = useState(0);
  const history = useSearchHistory();
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(() => {
    let active = true;
    hydrateSearchHistory();
    const readPermissions = () => {
      void getFileAccessStatus().then(status => { if (active) setMedia(status); });
      void FileEngine?.getPdfAccessAsync?.().then(result => { if (active) setAllFiles(result.granted); }).catch(() => {});
    };
    readPermissions();
    const timer = setTimeout(() => { if (active) setCache(cacheBytes()); }, 0);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') readPermissions(); });
    return () => { active = false; clearTimeout(timer); subscription.remove(); };
  }, []);
  useFocusEffect(refresh);

  function clearCache() {
    showDialog('Clear unused previews?', 'Removes cached thumbnails that are not in use. Your files, saved edits and open editing sessions stay unchanged. Previews are recreated when needed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => {
        try {
          const freed = clearUnusedThumbnails();
          toast(freed ? `Freed ${formatSize(freed)}` : 'No unused previews to clear');
        } catch {
          toast('Some previews could not be cleared. Try again later.');
        } finally {
          setCache(cacheBytes());
        }
      } },
    ], { ios: 'trash', android: 'delete-outline' });
  }

  function clearRecents() {
    showDialog('Clear recent files?', 'Removes recent entries and their imported copies in Versara. Original files on your device and saved edits stay where they are.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => {
        setClearing(true);
        void clearRecentFiles().then(count => toast(count ? `Cleared ${count} recent ${count === 1 ? 'file' : 'files'}` : 'No recent files')).catch(() => toast('Could not clear recent files')).finally(() => setClearing(false));
      } },
    ], { ios: 'clock.arrow.circlepath', android: 'history' });
  }

  function showTips() {
    try { localStorage.removeItem('versara.guide.dismissed'); } catch { /* Optional preference. */ }
    toast('The welcome tip will show on Home');
  }

  function clearHistory() {
    showDialog('Clear search history?', 'Removes recent searches and recently used tools from this device. No files are deleted.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: () => { clearSearchHistory(); toast('Search history cleared'); } },
    ]);
  }

  function toggleHistory() {
    if (!history.enabled) { setSearchHistoryEnabled(true); return; }
    showDialog('Turn off search history?', 'Existing search and tool history will be cleared. New activity will not be remembered.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Turn off', onPress: () => setSearchHistoryEnabled(false) },
    ]);
  }

  async function shareApp() {
    try { await Share.share({ message: 'Try Versara — offline PDF and image tools that keep files on your device.' }); } catch { /* Dismissed. */ }
  }

  const mediaLabel = media === 'granted' ? 'Allowed' : media === 'unavailable' ? 'Needs new build' : 'Not allowed';
  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ backgroundColor: colors.systemBackground }} contentContainerStyle={styles.content}>
      <View style={{ gap: s.sm }}><ThemedText accessibilityRole="header" style={[styles.title, { color: colors.label }]}>Settings</ThemedText><ThemedText style={{ color: colors.secondaryLabel }}>Make Versara feel right for you.</ThemedText></View>

      <Section title="Appearance">
        <Row icon={{ ios: 'circle.lefthalf.filled', android: 'contrast' }} title="Theme" trailing={<AppearanceButtons compact />} />
        <Row icon={{ ios: 'square.grid.2x2', android: 'grid-view' }} title="Home layout" caption="Grid or list" trailing={<LayoutToggle />} />
        <Row icon={{ ios: 'figure.walk', android: 'animation' }} title="Motion" caption="Follows your device accessibility preference" value={reducedMotion ? 'Reduced' : 'Standard'} />
      </Section>

      <Section title="Search & history">
        <Row icon={{ ios: 'clock', android: 'history' }} title="Remember recent activity" caption="Searches and used tools, stored only on this device" trailing={<Host colorScheme={mode} matchContents><Switch value={history.enabled} onValueChange={toggleHistory} /></Host>} />
        <Row icon={{ ios: 'trash', android: 'delete-outline' }} title="Clear search history" caption={`${history.queries.length} searches · ${history.tools.length} tools`} disabled={!history.queries.length && !history.tools.length} onPress={clearHistory} />
      </Section>

      <Section title="Files & storage">
        <Row icon={{ ios: 'square.and.pencil', android: 'edit-note' }} title="Edited files" caption="Open, rename, duplicate and export your work" onPress={() => router.push('/edited-files')} />
        <Row icon={{ ios: 'photo.on.rectangle', android: 'perm-media' }} title="Photo library" caption={mediaLabel} disabled={!isFileEngineAvailable() || media === 'granted'} onPress={() => { void requestFileAccess().then(setMedia); }} value={media === 'granted' || !isFileEngineAvailable() ? undefined : 'Allow'} />
        {Platform.OS === 'android' && allFiles !== null && (
          <Row icon={{ ios: 'folder', android: 'folder-shared' }} title="All files access" caption={allFiles ? 'Allowed — Files and Search can browse storage' : 'Needed for Files and Search'} disabled={allFiles} onPress={() => { void FileEngine?.requestPdfAccessAsync().then(result => setAllFiles(result.granted)).catch(() => toast('Could not open permission settings')); }} value={allFiles ? undefined : 'Allow'} />
        )}
        <Row icon={{ ios: 'externaldrive', android: 'cleaning-services' }} title="Clear unused previews" caption={cache ? `${formatSize(cache)} available to clear` : 'No unused previews'} disabled={!cache} onPress={clearCache} />
        <Row icon={{ ios: 'clock.arrow.circlepath', android: 'history' }} title="Clear recent files" caption={clearing ? 'Clearing…' : 'Remove recent entries and imported copies'} disabled={clearing} onPress={clearRecents} />
        <Row icon={{ ios: 'gearshape.2', android: 'app-settings-alt' }} title="System app settings" caption="Permissions and notifications" onPress={() => { void Linking.openSettings().catch(() => toast('Could not open system settings')); }} external />
      </Section>

      <Section title="Help">
        <Row icon={{ ios: 'questionmark.circle', android: 'help-outline' }} title="Quick guide" caption="Three steps and a short demo" onPress={() => router.push('/guide')} />
        <Row icon={{ ios: 'lightbulb', android: 'tips-and-updates' }} title="Show welcome tip again" caption="Back on the Home screen" onPress={showTips} />
      </Section>

      <Section title="About">
        <Row icon={{ ios: 'info.circle', android: 'info-outline' }} title="Version" value={VERSION} />
        <Row icon={{ ios: 'hand.raised', android: 'privacy-tip' }} title="Privacy" caption="Offline, no account, no tracking" onPress={() => showDialog('Privacy', PRIVACY, undefined, { ios: 'hand.raised', android: 'privacy-tip' })} />
        <Row icon={{ ios: 'doc.plaintext', android: 'description' }} title="Open-source licences" onPress={() => showDialog('Open-source licences', LICENSES, undefined, { ios: 'doc.plaintext', android: 'description' })} />
        <Row icon={{ ios: 'square.and.arrow.up', android: 'share' }} title="Share Versara" onPress={() => { void shareApp(); }} />
      </Section>

      <View style={[styles.developer, { backgroundColor: colors.catalogSurface, borderColor: colors.catalogBorder }]}>
        <View style={[styles.devBadge, { backgroundColor: colors.imageSurface }]}><UniversalIcon ios="chevron.left.forwardslash.chevron.right" android="code" size={22} color={colors.imageInk} /></View>
        <ThemedText style={[styles.devTitle, brandFont.display, { color: colors.label }]}>Built for your files</ThemedText>
        <ThemedText style={[styles.devBody, { color: colors.secondaryLabel }]}>PDF and image tools that work on your device. No account, no uploads, and your work stays yours.</ThemedText>
        <ThemedText style={[styles.devFoot, { color: colors.secondaryLabel }]}>Versara {VERSION} · Crafted with care</ThemedText>
      </View>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const colors = usePalette();
  return (
    <View style={styles.section}>
      <ThemedText style={[styles.heading, { color: colors.secondaryLabel }]}>{title}</ThemedText>
      <View style={[styles.group, { backgroundColor: colors.catalogSurface, borderColor: colors.catalogBorder }]}>{children}</View>
    </View>
  );
}

type RowProps = { icon: { ios: Icon['ios']; android: Icon['android'] }; title: string; caption?: string; value?: string; trailing?: ReactNode; onPress?: () => void; disabled?: boolean; external?: boolean };
function Row({ icon, title, caption, value, trailing, onPress, disabled, external }: RowProps) {
  const colors = usePalette();
  const tint = toolColors(icon.android, colors);
  const content = <>
    <View style={[styles.icon, { backgroundColor: tint.surface }]}><UniversalIcon ios={icon.ios} android={icon.android} size={19} color={tint.ink} /></View>
    <View style={styles.grow}>
      <ThemedText style={[styles.label, { color: colors.label }]}>{title}</ThemedText>
      {!!caption && <ThemedText style={[styles.caption, { color: colors.secondaryLabel }]}>{caption}</ThemedText>}
    </View>
    {trailing}
    {!!value && <ThemedText style={[styles.value, { color: onPress && !disabled ? colors.systemBlue : colors.secondaryLabel }]}>{value}</ThemedText>}
    {onPress && !disabled && !value && <UniversalIcon ios={external ? 'arrow.up.right' : 'chevron.right'} android={external ? 'open-in-new' : 'chevron-right'} size={external ? 16 : 18} color={colors.muted} />}
  </>;
  if (!onPress || disabled) return <View style={[styles.row, { borderTopColor: colors.tileBorder }]}>{content}</View>;
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, { borderTopColor: colors.tileBorder, opacity: pressed ? 0.6 : 1 }]}>{content}</Pressable>;
}

const styles = StyleSheet.create({
  content: { padding: s.xl, gap: s.xl, width: '100%', maxWidth: 720, alignSelf: 'center', paddingBottom: s.large },
  title: { ...t.title },
  section: { gap: s.sm },
  heading: { ...t.eyebrow, textTransform: 'uppercase', marginLeft: s.xs },
  group: { borderRadius: 20, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: s.md, minHeight: 60, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, marginTop: -StyleSheet.hairlineWidth },
  icon: { width: 34, height: 34, borderRadius: 10, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, gap: 2 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  caption: { ...t.caption },
  value: { fontSize: 14, fontWeight: '600' },
  developer: { borderRadius: 24, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, padding: s.xl, gap: s.sm, overflow: 'hidden' },
  devBadge: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: s.xs },
  devTitle: { fontSize: 19, lineHeight: 25 },
  devBody: { fontSize: 14, lineHeight: 21 },
  devFoot: { fontSize: 12, lineHeight: 16, marginTop: s.xs, opacity: 0.8 },
});
