import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';

type Slot = { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
let slot: Slot | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Undo and redo published by the open tool, shown in the screen header. */
export function useHeaderHistory() {
  return useSyncExternalStore(subscribe, () => slot, () => null);
}

export function HeaderHistoryButtons({ canUndo, canRedo, onUndo, onRedo, disabled = false }: {
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; disabled?: boolean;
}) {
  const colors = usePalette();
  const button = (label: string, enabled: boolean, onPress: () => void, ios: 'arrow.uturn.backward' | 'arrow.uturn.forward', android: 'undo' | 'redo') =>
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || !enabled} onPress={onPress} hitSlop={4}
      style={[styles.button, (disabled || !enabled) && styles.dim]}>
      <UniversalIcon ios={ios} android={android} size={22} color={colors.systemBlue} />
    </Pressable>;
  return <View style={styles.row}>
    {button('Undo', canUndo, onUndo, 'arrow.uturn.backward', 'undo')}
    {button('Redo', canRedo, onRedo, 'arrow.uturn.forward', 'redo')}
  </View>;
}

/** Header buttons for whichever tool is publishing history. Renders nothing when the tool has no undo. */
export function HeaderHistorySlot() {
  const history = useHeaderHistory();
  if (!history) return null;
  return <HeaderHistoryButtons canUndo={history.canUndo} canRedo={history.canRedo} onUndo={history.undo} onRedo={history.redo} />;
}

/** Registers the current tool's undo and redo with the screen header. */
export function PublishHeaderHistory({ active = true, canUndo, canRedo, onUndo, onRedo }: {
  active?: boolean; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
}) {
  const undo = useRef(onUndo);
  const redo = useRef(onRedo);
  useEffect(() => {
    undo.current = onUndo;
    redo.current = onRedo;
  });
  useEffect(() => {
    if (!active) { slot = null; emit(); return; }
    slot = { canUndo, canRedo, undo: () => undo.current(), redo: () => redo.current() };
    emit();
    return () => { slot = null; emit(); };
  }, [active, canUndo, canRedo]);
  return null;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  button: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.35 },
});
