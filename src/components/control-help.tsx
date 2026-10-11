import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, BackHandler, Keyboard, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from './themed-text';
import { UniversalIcon } from './universal-icon';
import { useScreenActive } from '@/hooks/use-screen-active';
import { usePalette } from '@/theme/colors';

type ControlHelp = {
  active: boolean; toggle: () => void; close: () => boolean;
  /** A control explained itself, so the surrounding touch needs no hint. */
  handled: () => void;
  /** Increments whenever a stray touch should point the user back to the ? button. */
  cue: number;
  /** Help or another ?-toggled naming mode (such as the tool ring's) is showing. */
  showing: boolean;
  setExternal: (active: boolean) => void;
};
const ControlHelpContext = createContext<ControlHelp | null>(null);
export const useControlHelp = () => useContext(ControlHelpContext);

const CLOSE_HINT = 'Help mode is on. Tap ? again to close it.';
const HINT_MS = 2600;

/** Lets a ?-toggled mode outside control help (such as naming tools) share the "tap ? again" hint. */
export function useExternalHelpMode(active: boolean) {
  const setExternal = useContext(ControlHelpContext)?.setExternal;
  useEffect(() => {
    if (!setExternal || !active) return;
    setExternal(true);
    return () => setExternal(false);
  }, [setExternal, active]);
}

/** Modal sheet portals render outside the route; carry its help context into their content. */
export function ControlHelpBridge({ value, children }: { value: ReturnType<typeof useControlHelp>; children: ReactNode }) {
  return <ControlHelpContext.Provider value={value}>{children}</ControlHelpContext.Provider>;
}

/** Screen-scoped help state, shared by the header and controls (including sheet portals). */
export function ControlHelpProvider({ children }: { children: ReactNode }) {
  const visible = useScreenActive();
  const colors = usePalette();
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState(false);
  const [cue, setCue] = useState(0);
  const [hint, setHint] = useState(false);
  const [external, setExternal] = useState(false);
  if (!visible && active) setActive(false);
  const helping = active && visible;
  const showing = (active || external) && visible;
  if (!showing && hint) setHint(false);
  const toggle = useCallback(() => { Keyboard.dismiss(); setActive(value => !value); }, []);
  const close = useCallback(() => { if (!active) return false; setActive(false); return true; }, [active]);
  const lastHandled = useRef(0);
  const touchStart = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const handled = useCallback(() => { lastHandled.current = Date.now(); }, []);
  const helpingRef = useRef(showing);
  useEffect(() => { helpingRef.current = showing; }, [showing]);
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', close);
    return () => subscription.remove();
  }, [active, close]);
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(timer);
  }, [hint, cue]);
  useEffect(() => () => clearTimeout(pending.current), []);
  const onTouchStart = () => { touchStart.current = helpingRef.current ? Date.now() : 0; };
  const onTouchEnd = () => {
    const started = touchStart.current;
    if (!started) return;
    clearTimeout(pending.current);
    // Controls report their explanation on press; wait for that before deciding the touch landed elsewhere.
    pending.current = setTimeout(() => {
      if (!helpingRef.current || lastHandled.current >= started) return;
      setCue(value => value + 1);
      setHint(true);
      AccessibilityInfo.announceForAccessibility(CLOSE_HINT);
    }, 250);
  };
  const value = useMemo(() => ({ active: helping, toggle, close, handled, cue, showing, setExternal }), [helping, toggle, close, handled, cue, showing]);
  return <ControlHelpContext.Provider value={value}>
    <View style={styles.root} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {children}
      {hint && showing && <Animated.View pointerEvents="none" entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)} exiting={FadeOut.duration(160).reduceMotion(ReduceMotion.System)}
        style={[styles.hint, { top: insets.top + 64, backgroundColor: colors.label }]}>
        <View style={[styles.mark, { backgroundColor: colors.systemBackground }]}><UniversalIcon ios="questionmark" android="question-mark" size={16} color={colors.label} /></View>
        <ThemedText style={[styles.hintText, { color: colors.systemBackground }]}>{CLOSE_HINT}</ThemedText>
      </Animated.View>}
    </View>
  </ControlHelpContext.Provider>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hint: { position: 'absolute', alignSelf: 'center', maxWidth: 360, marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingLeft: 10, paddingRight: 16, borderRadius: 22, boxShadow: '0px 4px 14px rgba(0, 0, 0, 0.22)' },
  mark: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  hintText: { flexShrink: 1, fontSize: 14, fontWeight: '600' },
});
