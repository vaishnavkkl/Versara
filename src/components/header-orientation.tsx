import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';

export type HeaderOrientationAction = { landscape: boolean; disabled?: boolean; onToggle: () => void };

let slot: HeaderOrientationAction | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The portrait/landscape switch a reader publishes for the screen header, next to its close button. */
export function useHeaderOrientation() {
  return useSyncExternalStore(subscribe, () => slot, () => null);
}

/** Rendered in a close-style header; shows nothing until a reader publishes its switch. */
export function HeaderOrientationButton() {
  const colors = usePalette();
  const orientation = useHeaderOrientation();
  if (!orientation) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel={orientation.landscape ? 'Switch to portrait' : 'Switch to landscape'}
    accessibilityState={{ selected: orientation.landscape, disabled: orientation.disabled }} disabled={orientation.disabled} onPress={orientation.onToggle} hitSlop={4}
    style={({ pressed }) => [styles.button, { backgroundColor: colors.accentSurface, opacity: orientation.disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
    <UniversalIcon ios={orientation.landscape ? 'rectangle.portrait' : 'rectangle'} android="screen-rotation" size={20} color={colors.systemBlue} />
  </Pressable>;
}

const styles = StyleSheet.create({ button: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' } });

export function usePublishHeaderOrientation({ active = true, landscape, disabled = false, onToggle }: {
  active?: boolean; landscape: boolean; disabled?: boolean; onToggle: () => void;
}) {
  const toggle = useRef(onToggle);
  useEffect(() => { toggle.current = onToggle; });
  useEffect(() => {
    if (!active) return;
    slot = { landscape, disabled, onToggle: () => toggle.current() };
    emit();
    return () => { slot = null; emit(); };
  }, [active, landscape, disabled]);
}
