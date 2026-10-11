import { useEffect, useRef, useSyncExternalStore } from 'react';
import { HelpPressable as Pressable } from './help-pressable';
import { headerButtonStyle } from './header-actions';
import { HeaderGlyph } from './app-glyph';

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
  const orientation = useHeaderOrientation();
  if (!orientation) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel={orientation.landscape ? 'Switch to portrait' : 'Switch to landscape'}
    accessibilityState={{ selected: orientation.landscape, disabled: orientation.disabled }} disabled={orientation.disabled} onPress={orientation.onToggle} hitSlop={2}
    style={({ pressed }) => [headerButtonStyle, { opacity: orientation.disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
    <HeaderGlyph id="orientation" ios={orientation.landscape ? 'rectangle.portrait' : 'rectangle'} android="mdi:phone-rotate-landscape" />
  </Pressable>;
}

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
