import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BackHandler, Keyboard } from 'react-native';
import { useScreenActive } from '@/hooks/use-screen-active';

const ControlHelpContext = createContext<{ active: boolean; toggle: () => void; close: () => boolean } | null>(null);
export const useControlHelp = () => useContext(ControlHelpContext);

/** Modal sheet portals render outside the route; carry its help context into their content. */
export function ControlHelpBridge({ value, children }: { value: ReturnType<typeof useControlHelp>; children: ReactNode }) {
  return <ControlHelpContext.Provider value={value}>{children}</ControlHelpContext.Provider>;
}

/** Screen-scoped help state, shared by the header and controls (including sheet portals). */
export function ControlHelpProvider({ children }: { children: ReactNode }) {
  const visible = useScreenActive();
  const [active, setActive] = useState(false);
  if (!visible && active) setActive(false);
  const toggle = useCallback(() => { Keyboard.dismiss(); setActive(value => !value); }, []);
  const close = useCallback(() => { if (!active) return false; setActive(false); return true; }, [active]);
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', close);
    return () => subscription.remove();
  }, [active, close]);
  const value = useMemo(() => ({ active: active && visible, toggle, close }), [active, visible, toggle, close]);
  return <ControlHelpContext.Provider value={value}>{children}</ControlHelpContext.Provider>;
}
