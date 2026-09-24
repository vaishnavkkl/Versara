import { useCallback, useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Constants from 'expo-constants';
import { Directory, Paths } from 'expo-file-system';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { AppearanceButtons } from '@/components/appearance-buttons';
import { LayoutToggle } from '@/components/layout-toggle';
import { showDialog } from '@/components/app-dialog';
import { toast } from '@/components/toast';
import { usePalette } from '@/theme/colors';
import { brandFont, getGradients, spacing as s, typography as t } from '@/theme/dashboard';
import { getFileAccessStatus, isFileEngineAvailable, requestFileAccess, type FileAccessStatus } from '@/features/files/file-access';
import { clearRecentFiles } from '@/features/files/recent-files';
import { formatSize } from '@/features/files/file-storage';
import { FileEngine } from '../../../../modules/file-engine';

type Icon = React.ComponentProps<typeof UniversalIcon>;
const VERSION = Constants.expoConfig?.version ?? '1.0.0';
const LICENSES = 'Versara is built with free and open-source software, including:\n\n• PDFium (BSD-3-Clause / Apache-2.0)\n• React Native (MIT)\n• Expo SDK (MIT)\n• React Native Reanimated (MIT)\n• Sora typeface (SIL Open Font License)\n• Material Icons (Apache-2.0)';
const PRIVACY = 'Versara works offline. PDFs, images, videos and audio are processed on this device and are never uploaded.\n\nThere is no account, no analytics and no ads. Your preferences are stored only on this phone.';

function cacheBytes() {
  try { return Paths.cache.info().size ?? 0; } catch { return 0; }
}

export default function SettingsScreen() {
  const colors = usePalette();
  const [media, setMedia] = useState<FileAccessStatus>('unavailable');
  const [allFiles, setAllFiles] = useState<boolean | null>(null);
  const [cache, setCache] = useState(0);

  const refresh = useCallback(() => {
    let active = true;
    void getFileAccessStatus().then(status => { if (active) setMedia(status); });
    void FileEngine?.getPdfAccessAsync?.().then(result => { if (active) setAllFiles(result.granted); }).catch(() => {});
    setTimeout(() => { if (active) setCache(cacheBytes()); }, 0);
    return () => { active = false; };
  }, []);
  useFocusEffect(refresh);

  function clearCache() {
    showDialog('Clear cache?', `Frees ${formatSize(cache)} of temporary previews and copies. Your files and edits are not affected.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => {
        try {
          for (const item of Paths.cache.list()) { try { item.delete(); } catch { /* In use; cleared next time. */ } }
          new Directory(Paths.cache, 'versara-thumbnails').create({ intermediates: true, idempotent: true });
        } finally {
          setCache(cacheBytes());
          toast('Cache cleared');
        }
      } },
    ], { ios: 'trash', android: 'delete-outline' });
  }

  function clearRecents() {
    showDialog('Clear recent files?', 'Removes files from your recent lists. Originals on your device and saved edits stay where they are.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => {
        void clearRecentFiles().then(count => toast(count ? `Cleared ${count} recent ${count === 1 ? 'file' : 'files'}` : 'No recent files')).catch(() => toast('Could not clear recent files'));
      } },
    ], { ios: 'clock.arrow.circlepath', android: 'history' });
  }

  function showTips() {
    try { localStorage.removeItem('versara.guide.dismissed'); } catch { /* Optional preference. */ }
    toast('The welcome tip will show on Home');
  }

  async function shareApp() {
    try { await Share.share({ message: 'Try Versara — offline PDF, image, video and audio tools that keep files on your device.' }); } catch { /* Dismissed. */ }
  }

  const mediaLabel = media === 'granted' ? 'Allowed' : media === 'unavailable' ? 'Needs new build' : 'Not allowed';
  return (
    <ScrollView style={[{ backgroundColor: colors.systemBackground }, getGradients(colors).dashboard]} contentContainerStyle={styles.content}>
      <ThemedText accessibilityRole="header" style={[styles.title, { color: colors.label }]}>Settings</ThemedText>

      <Section title="Appearance">
        <Row icon={{ ios: 'circle.lefthalf.filled', android: 'contrast' }} title="Theme" trailing={<AppearanceButtons compact />} />
        <Row icon={{ ios: 'square.grid.2x2', android: 'grid-view' }} title="Home layout" caption="Grid or list" trailing={<LayoutToggle />} />
      </Section>

      <Section title="Files & storage">
        <Row icon={{ ios: 'photo.on.rectangle', android: 'perm-media' }} title="Photos, videos & audio" caption={mediaLabel} disabled={!isFileEngineAvailable() || media === 'granted'} onPress={() => { void requestFileAccess().then(setMedia); }} value={media === 'granted' ? undefined : 'Allow'} />
        {Platform.OS === 'android' && allFiles !== null && (
          <Row icon={{ ios: 'folder', android: 'folder-shared' }} title="All files access" caption={allFiles ? 'Allowed — Files and Search can browse storage' : 'Needed for Files and Search'} disabled={allFiles} onPress={() => { void FileEngine?.requestPdfAccessAsync().finally(refresh); }} value={allFiles ? undefined : 'Allow'} />
        )}
        <Row icon={{ ios: 'externaldrive', android: 'cleaning-services' }} title="Clear cache" caption={`${formatSize(cache)} of temporary files`} onPress={clearCache} />
        <Row icon={{ ios: 'clock.arrow.circlepath', android: 'history' }} title="Clear recent files" caption="Empty the recent lists" onPress={clearRecents} />
        <Row icon={{ ios: 'gearshape.2', android: 'app-settings-alt' }} title="System app settings" caption="Permissions and notifications" onPress={() => { void Linking.openSettings(); }} external />
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

      <View style={[styles.developer, getGradients(colors).module, { backgroundColor: colors.moduleEnd, borderColor: colors.moduleBorder }]}>
        <View style={styles.devBadge}><UniversalIcon ios="chevron.left.forwardslash.chevron.right" android="code" size={22} color="#FFFFFF" /></View>
        <ThemedText style={[styles.devTitle, brandFont.display, { color: colors.moduleText }]}>Made by an enthusiast developer</ThemedText>
        <ThemedText style={[styles.devBody, { color: colors.moduleDescription }]}>Versara is a passion project, built by one developer who loves fast, private, native tools. Every feature runs on your phone, with no servers and no sign-up.</ThemedText>
        <ThemedText style={[styles.devFoot, { color: colors.moduleDescription }]}>Versara {VERSION} · Crafted with care</ThemedText>
      </View>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const colors = usePalette();
  return (
    <View style={styles.section}>
      <ThemedText style={[styles.heading, { color: colors.secondaryLabel }]}>{title}</ThemedText>
      <View style={[styles.group, { backgroundColor: colors.tileSurface, borderColor: colors.tileBorder, boxShadow: colors.tileShadow }]}>{children}</View>
    </View>
  );
}

type RowProps = { icon: { ios: Icon['ios']; android: Icon['android'] }; title: string; caption?: string; value?: string; trailing?: ReactNode; onPress?: () => void; disabled?: boolean; external?: boolean };
function Row({ icon, title, caption, value, trailing, onPress, disabled, external }: RowProps) {
  const colors = usePalette();
  const content = <>
    <View style={[styles.icon, { backgroundColor: colors.accentSurface }]}><UniversalIcon ios={icon.ios} android={icon.android} size={19} color={colors.systemBlue} /></View>
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
  devBadge: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#FFFFFF1F', alignItems: 'center', justifyContent: 'center', marginBottom: s.xs },
  devTitle: { fontSize: 19, lineHeight: 25 },
  devBody: { fontSize: 14, lineHeight: 21 },
  devFoot: { fontSize: 12, lineHeight: 16, marginTop: s.xs, opacity: 0.8 },
});
