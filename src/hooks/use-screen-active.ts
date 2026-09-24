import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router/react-navigation';

/** Keep lightweight screen state; release expensive views while covered/backgrounded. */
export function useScreenActive() {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setForeground(state !== 'background'));
    return () => subscription.remove();
  }, []);
  return focused && foreground;
}
