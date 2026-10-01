import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { AppLoader } from './app-loader';
import { showDialog } from './app-dialog';
import type { HeaderShareAction } from './header-share';
import { usePalette } from '@/theme/colors';
import { spacing as s, typography as t } from '@/theme/dashboard';

type Props = { title: string; onBack: () => void; backLabel?: string; variant?: 'back' | 'close'; children?: ReactNode;
  /** Tool screens share their current edited file from the right. `null` shows the button disabled. */
  share?: HeaderShareAction | null;
  /** Tool screens save or apply their result from the right, beside share. `null` shows the button disabled. */
  save?: HeaderShareAction | null;
  /** Extra actions shown beside the close button in the close variant. */
  trailing?: ReactNode };

/** Screens go back from the left; file previews and sheets close from the right. The title stays centred. */
export function ScreenHeader({ title, onBack, backLabel, variant = 'back', children, share, save, trailing }: Props) {
  const colors = usePalette();
  const close = variant === 'close';
  const [sharing, setSharing] = useState(false);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function runShare() {
    if (!share || share.disabled || sharing) return;
    Keyboard.dismiss(); setSharing(true);
    try { await share.onPress(); }
    catch (cause) { showDialog('Could not share', (cause as Error).message || 'Please try again.', undefined, { ios: 'square.and.arrow.up', android: 'share' }); }
    finally { if (mounted.current) setSharing(false); }
  }
  async function runSave() {
    if (!save || save.disabled || saving) return;
    Keyboard.dismiss(); setSaving(true);
    try { await save.onPress(); }
    catch (cause) { showDialog('Could not save', (cause as Error).message || 'Please try again.', undefined, { ios: 'square.and.arrow.down', android: 'save' }); }
    finally { if (mounted.current) setSaving(false); }
  }
  const button = <Pressable accessibilityRole="button" accessibilityLabel={backLabel ?? (close ? 'Close preview' : 'Go back')} onPress={onBack} hitSlop={4}
    style={({ pressed }) => [styles.back, close && { backgroundColor: colors.accentSurface, borderRadius: 22 }, { opacity: pressed ? 0.6 : 1 }]}>
    <UniversalIcon ios={close ? 'xmark' : 'chevron.left'} android={close ? 'close' : 'arrow-back'} size={22} color={colors.systemBlue} />
  </Pressable>;
  const shareDisabled = !share || !!share.disabled || sharing;
  const shareButton = share !== undefined && <Pressable accessibilityRole="button" accessibilityLabel={share?.label ?? 'Share'} accessibilityState={{ disabled: shareDisabled, busy: sharing }}
    disabled={shareDisabled} onPress={() => void runShare()} hitSlop={4}
    style={({ pressed }) => [styles.back, styles.share, { backgroundColor: colors.accentSurface, opacity: shareDisabled && !sharing ? 0.4 : pressed ? 0.6 : 1 }]}>
    {sharing ? <AppLoader /> : <UniversalIcon ios="square.and.arrow.up" android="share" size={21} color={colors.systemBlue} />}
  </Pressable>;
  const saveDisabled = !save || !!save.disabled || saving;
  const saveButton = save !== undefined && <Pressable accessibilityRole="button" accessibilityLabel={save?.label ?? 'Save'} accessibilityState={{ disabled: saveDisabled, busy: saving }}
    disabled={saveDisabled} onPress={() => void runSave()} hitSlop={4}
    style={({ pressed }) => [styles.back, styles.share, { backgroundColor: colors.accentSurface, opacity: saveDisabled && !saving ? 0.4 : pressed ? 0.6 : 1 }]}>
    {saving ? <AppLoader /> : <UniversalIcon ios="square.and.arrow.down" android="save" size={21} color={colors.systemBlue} />}
  </Pressable>;
  const actions = close ? 1 : (children ? 1 : 0) + (share !== undefined ? 1 : 0) + (save !== undefined ? 1 : 0);
  // Both sides reserve room for the busier one so the title stays centred and shrinks first.
  const sideWidth = { minWidth: Math.max(44, actions * 44 + (actions - 1) * s.xs) };
  return <View style={[styles.header, close && styles.closeHeader, { borderColor: colors.separator }]}>
    <View style={[styles.side, styles.start, sideWidth]}>{close ? children : button}</View>
    <ThemedText accessibilityRole="header" numberOfLines={1} style={styles.title}>{title}</ThemedText>
    <View style={[styles.side, styles.end, sideWidth]}>{close ? <>{trailing}{button}</> : <>{children}{saveButton}{shareButton}</>}</View>
  </View>;
}

const styles = StyleSheet.create({
  header: { minHeight: 52, paddingLeft: s.xs, paddingRight: s.sm, flexDirection: 'row', alignItems: 'center', gap: s.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  closeHeader: { paddingLeft: s.md, paddingRight: s.sm },
  // Equal flexible sides keep the title centred whatever each side holds.
  side: { flex: 1, minWidth: 44, flexDirection: 'row', alignItems: 'center' },
  start: { justifyContent: 'flex-start' },
  end: { justifyContent: 'flex-end', gap: s.xs },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  share: { borderRadius: 12 },
  title: { flexShrink: 1, maxWidth: '62%', ...t.label, fontSize: 17, textAlign: 'center' },
});
