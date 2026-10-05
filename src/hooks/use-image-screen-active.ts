import { useLayoutEffect, useState } from 'react';
import { useNavigation, type NativeStackNavigationProp } from 'expo-router';
import { useScreenActive } from './use-screen-active';

/** Keep native decode and GPU upload out of the navigation animation. */
export function useImageScreenActive() {
  const active = useScreenActive();
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const [activation, setActivation] = useState({ active, ready: false });
  if (activation.active !== active) setActivation({ active, ready: false });
  useLayoutEffect(() => {
    if (!active) return;
    // Direct links and replacements may not emit transitionEnd.
    const fallback = setTimeout(() => setActivation({ active: true, ready: true }), 500);
    const release = navigation.addListener('transitionEnd', event => {
      if (!event.data.closing) { clearTimeout(fallback); setActivation({ active: true, ready: true }); }
    });
    return () => { clearTimeout(fallback); release(); };
  }, [active, navigation]);
  return active && activation.active && activation.ready;
}
