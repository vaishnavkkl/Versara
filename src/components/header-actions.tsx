import { useEffect, useRef, useSyncExternalStore } from 'react';
import { StyleSheet } from 'react-native';
import { HelpPressable as Pressable } from './help-pressable';
import { UniversalIcon } from './universal-icon';
import { usePalette } from '@/theme/colors';

type Icon = React.ComponentProps<typeof UniversalIcon>;
export type HeaderAction = { id: string; label: string; ios: Icon['ios']; android: Icon['android']; selected?: boolean; disabled?: boolean; onPress: () => void };

let slot: HeaderAction[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const EMPTY: HeaderAction[] = [];

/** Every button in a close-style header shares this size, so the row reads as one quiet group. */
export const HEADER_ICON_SIZE = 22;
export const headerButtonStyle = StyleSheet.create({ button: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' } }).button;

export function HeaderIconButton({ label, ios, android, selected, disabled, onPress }: Omit<HeaderAction, 'id'>) {
  const colors = usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!selected, disabled: !!disabled }} disabled={disabled} onPress={onPress} hitSlop={2}
    style={({ pressed }) => [headerButtonStyle, { backgroundColor: selected ? colors.accentSurface : 'transparent', opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
    <UniversalIcon ios={ios} android={android} size={HEADER_ICON_SIZE} color={colors.systemBlue} />
  </Pressable>;
}

/** Rendered in a close-style header; shows the buttons a reader publishes, such as bookmarks and reading options. */
export function HeaderActions() {
  const actions = useSyncExternalStore(subscribe, () => slot, () => EMPTY);
  return actions.map(({ id, ...action }) => <HeaderIconButton key={id} {...action} />);
}

export function usePublishHeaderActions(active: boolean, actions: HeaderAction[]) {
  const handlers = useRef(new Map<string, () => void>());
  useEffect(() => { handlers.current = new Map(actions.map(action => [action.id, action.onPress])); });
  const signature = JSON.stringify(actions.map(({ onPress: _onPress, ...rest }) => rest));
  useEffect(() => {
    if (!active) return;
    const published: HeaderAction[] = (JSON.parse(signature) as Omit<HeaderAction, 'onPress'>[])
      .map(action => ({ ...action, onPress: () => handlers.current.get(action.id)?.() }));
    slot = published;
    emit();
    return () => { if (slot === published) { slot = EMPTY; emit(); } };
  }, [active, signature]);
}
