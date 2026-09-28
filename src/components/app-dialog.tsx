import { useEffect, useState, type ComponentProps } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { create } from 'zustand';
import { useReducedMotion } from 'react-native-reanimated';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { usePalette } from '@/theme/colors';
import { radius, spacing, typography } from '@/theme/dashboard';

type Icon = ComponentProps<typeof UniversalIcon>;
export type DialogAction = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };
type Dialog = { id: number; title: string; message?: string; icon?: Pick<Icon, 'ios' | 'android'>; actions: DialogAction[]; input?: { value: string; validate: (value: string) => string; submit: (value: string) => void } };

const MAX_QUEUED = 4;
let nextId = 0;
const useDialogs = create<{ queue: Dialog[] }>(() => ({ queue: [] }));

/** In-app replacement for Alert.alert. Actions run after the dialog has closed. */
export function showDialog(title: string, message?: string, actions: DialogAction[] = [{ text: 'OK' }], icon?: Dialog['icon']) {
  enqueue({ id: ++nextId, title, message, actions, icon });
}

function enqueue(dialog: Dialog) {
  const queue = useDialogs.getState().queue;
  if (queue.length >= MAX_QUEUED) {
    dialog.actions.find(action => action.style === 'cancel')?.onPress?.();
    return;
  }
  useDialogs.setState({ queue: [...queue, dialog] });
}

export function promptFileName(value: string, validate: (value: string) => string, labels?: { title: string; message: string; action: string }): Promise<string | null> {
  return new Promise(resolve => enqueue({
    id: ++nextId, title: labels?.title ?? 'Save as new', message: labels?.message ?? 'Choose a name for your new file.',
    actions: [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(null) }, { text: labels?.action ?? 'Save' }],
    input: { value, validate, submit: resolve },
  }));
}

function close(dialog: Dialog, action?: DialogAction) {
  if (!useDialogs.getState().queue.some(item => item.id === dialog.id)) return;
  Keyboard.dismiss();
  useDialogs.setState(state => ({ queue: state.queue.filter(item => item.id !== dialog.id) }));
  // Let the modal fade out first so pickers and system dialogs can present on Android.
  if (action?.onPress) setTimeout(action.onPress, 220);
}

export function DialogHost() {
  const colors = usePalette();
  const reducedMotion = useReducedMotion();
  const dialog = useDialogs(state => state.queue[0]);
  const [displayed, setDisplayed] = useState<Dialog>();
  if (dialog && displayed?.id !== dialog.id) setDisplayed(dialog);
  const content = dialog ?? displayed;
  useEffect(() => {
    if (dialog) return;
    const timer = setTimeout(() => setDisplayed(undefined), reducedMotion ? 0 : 320);
    return () => clearTimeout(timer);
  }, [dialog, reducedMotion]);
  const cancel = dialog?.actions.find(action => action.style === 'cancel') ?? (dialog?.actions.length === 1 ? dialog.actions[0] : undefined);
  return <Modal visible={!!dialog} transparent animationType={reducedMotion ? 'none' : 'fade'} statusBarTranslucent navigationBarTranslucent onRequestClose={() => { if (dialog) close(dialog, cancel); }}>
    {content && <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.scrim }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.backdrop} keyboardShouldPersistTaps="handled">
        <DialogContent key={content.id} dialog={content} />
      </ScrollView>
    </KeyboardAvoidingView>}
  </Modal>;
}

function DialogContent({ dialog }: { dialog: Dialog }) {
  const colors = usePalette();
  const { fontScale } = useWindowDimensions();
  const [value, setValue] = useState(dialog.input?.value ?? '');
  const [error, setError] = useState('');
  const stacked = dialog.actions.length > 2 || fontScale >= 1.4;
  function choose(action: DialogAction) {
    if (!dialog.input || action.style === 'cancel') { close(dialog, action); return; }
    const issue = dialog.input.validate(value.trim());
    if (issue) { setError(issue); return; }
    close(dialog, { ...action, onPress: () => dialog.input?.submit(value.trim()) });
  }
  return (
      <View accessibilityViewIsModal style={[styles.card, { backgroundColor: colors.sheetBackground, borderColor: colors.tileBorder, boxShadow: colors.tileShadow }]}>
        {dialog.icon && <View style={[styles.icon, { backgroundColor: colors.accentSurface, borderColor: colors.separator }]}>
          <UniversalIcon ios={dialog.icon.ios} android={dialog.icon.android} size={26} color={colors.label} />
        </View>}
        <ThemedText accessibilityRole="header" style={[styles.title, { color: colors.label }]}>{dialog.title}</ThemedText>
        {!!dialog.message && <ThemedText selectable selectionColor={`${colors.filesInk}44`} style={[styles.body, { color: colors.secondaryLabel }]}>{dialog.message}</ThemedText>}
        {dialog.input && <TextInput accessibilityLabel="File name" value={value} onChangeText={text => { setValue(text); setError(''); }}
          autoFocus selectTextOnFocus autoCorrect={false} autoCapitalize="none" maxLength={100} returnKeyType="done"
          selectionColor={`${colors.filesInk}44`} cursorColor={colors.label} selectionHandleColor={colors.filesInk} underlineColorAndroid="transparent"
          onSubmitEditing={() => choose(dialog.actions[dialog.actions.length - 1])}
          style={[styles.input, { color: colors.label, borderColor: colors.separator, backgroundColor: colors.fieldSurface }]} />}
        {!!error && <ThemedText accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</ThemedText>}
        <View style={[styles.actions, stacked && styles.stacked]}>
          {dialog.actions.map((action, index) => {
            const primary = action.style !== 'cancel' && index === dialog.actions.length - 1;
            const color = action.style === 'destructive' ? colors.destructive : primary ? colors.onAccent : colors.label;
            return <Pressable key={`${action.text}-${index}`} accessibilityRole="button" onPress={() => choose(action)}
              style={({ pressed }) => [styles.button, !stacked && styles.grow, primary && action.style !== 'destructive' && { backgroundColor: colors.accent },
                action.style === 'destructive' && { backgroundColor: `${colors.destructive}14` }, !primary && action.style !== 'destructive' && { borderColor: colors.separator, borderWidth: 1 }, { opacity: pressed ? 0.7 : 1 }]}>
              <ThemedText style={[styles.label, { color }]}>{action.text}</ThemedText>
            </Pressable>;
          })}
        </View>
      </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  input: { ...typography.body, minHeight: 48, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md },
  card: { borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1, padding: spacing.xxl, gap: spacing.md, maxWidth: 420, width: '100%', alignSelf: 'center' },
  icon: { width: 48, height: 48, borderRadius: radius.sm, borderCurve: 'continuous', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.heading },
  body: { ...typography.body },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  stacked: { flexDirection: 'column' },
  grow: { flex: 1 },
  button: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  label: { fontWeight: '600', textAlign: 'center' },
});
