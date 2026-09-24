import type { ComponentProps } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { create } from 'zustand';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { getGradients, radius, spacing, typography } from '@/theme/dashboard';

type Icon = ComponentProps<typeof UniversalIcon>;
export type DialogAction = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };
type Dialog = { id: number; title: string; message?: string; icon?: Pick<Icon, 'ios' | 'android'>; actions: DialogAction[] };

const MAX_QUEUED = 4;
let nextId = 0;
const useDialogs = create<{ queue: Dialog[] }>(() => ({ queue: [] }));

/** In-app replacement for Alert.alert. Actions run after the dialog has closed. */
export function showDialog(title: string, message?: string, actions: DialogAction[] = [{ text: 'OK' }], icon?: Dialog['icon']) {
  useDialogs.setState(state => ({ queue: [...state.queue, { id: ++nextId, title, message, actions, icon }].slice(-MAX_QUEUED) }));
}

function close(dialog: Dialog, action?: DialogAction) {
  useDialogs.setState(state => ({ queue: state.queue.filter(item => item.id !== dialog.id) }));
  // Let the modal fade out first so pickers and system dialogs can present on Android.
  if (action?.onPress) setTimeout(action.onPress, 220);
}

export function DialogHost() {
  const colors = usePalette();
  const dialog = useDialogs(state => state.queue[0]);
  const cancel = dialog?.actions.find(action => action.style === 'cancel') ?? (dialog?.actions.length === 1 ? dialog.actions[0] : undefined);
  const stacked = (dialog?.actions.length ?? 0) > 2;
  return <Modal visible={!!dialog} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => { if (dialog) close(dialog, cancel); }}>
    {dialog && <View style={[styles.backdrop, { backgroundColor: `${colors.systemBackground}CC` }]}>
      <View accessibilityViewIsModal style={[styles.card, getGradients(colors).module, { borderColor: colors.moduleBorder, boxShadow: colors.moduleShadow }]}>
        {dialog.icon && <View style={[styles.icon, { backgroundColor: colors.moduleIconSurface, borderColor: colors.moduleIconBorder }]}>
          <UniversalIcon ios={dialog.icon.ios} android={dialog.icon.android} size={26} color={colors.moduleText} />
        </View>}
        <ThemedText accessibilityRole="header" style={[styles.title, { color: colors.moduleText }]}>{dialog.title}</ThemedText>
        {!!dialog.message && <ThemedText selectable style={[styles.body, { color: colors.moduleDescription }]}>{dialog.message}</ThemedText>}
        <View style={[styles.actions, stacked && styles.stacked]}>
          {dialog.actions.map((action, index) => {
            const primary = action.style !== 'cancel' && index === dialog.actions.length - 1;
            const color = action.style === 'destructive' ? DESTRUCTIVE : primary ? colors.moduleEnd : colors.moduleText;
            return <Pressable key={`${action.text}-${index}`} accessibilityRole="button" onPress={() => close(dialog, action)}
              style={({ pressed }) => [styles.button, !stacked && styles.grow, primary && action.style !== 'destructive' && { backgroundColor: colors.onAccent },
                action.style === 'destructive' && styles.destructive, !primary && action.style !== 'destructive' && { borderColor: colors.moduleIconBorder, borderWidth: 1 }, { opacity: pressed ? 0.7 : 1 }]}>
              <ThemedText style={[styles.label, { color }]}>{action.text}</ThemedText>
            </Pressable>;
          })}
        </View>
      </View>
    </View>}
  </Modal>;
}

const DESTRUCTIVE = '#FFB4AB';
const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  card: { borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, padding: spacing.xxl, gap: spacing.md, maxWidth: 420, width: '100%', alignSelf: 'center' },
  icon: { width: 48, height: 48, borderRadius: radius.sm, borderCurve: 'continuous', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.heading },
  body: { ...typography.body },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  stacked: { flexDirection: 'column' },
  grow: { flex: 1 },
  button: { minHeight: 48, borderRadius: 24, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  destructive: { backgroundColor: '#FFB4AB22', borderWidth: 1, borderColor: '#FFB4AB66' },
  label: { fontWeight: '600', textAlign: 'center' },
});
