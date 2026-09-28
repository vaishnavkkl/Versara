import { useEffect, useState } from 'react';
import { useScreenActive } from '@/hooks/use-screen-active';

/** Let navigation commit and the covered native canvas release before opening another. */
export function usePdfScreenActive() {
  const active = useScreenActive();
  const [activation, setActivation] = useState({ active, ready: false });
  if (activation.active !== active) setActivation({ active, ready: false });
  useEffect(() => {
    if (!active) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setActivation({ active: true, ready: true }));
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return active && activation.active && activation.ready;
}
