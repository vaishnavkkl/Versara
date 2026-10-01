import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Lets a native slider own its thumb while dragging. Echoing every emitted value back as a prop
 * makes the thumb fight the finger when React lags; only outside changes (reset, undo, switching
 * settings) are pushed to the native control.
 */
export function useSliderValue(value: number, onChange: (value: number) => void, tolerance = 1e-9) {
  const [shown, setShown] = useState(value);
  const emitted = useRef(value);
  // `tolerance` absorbs the caller's rounding or clamping of emitted values.
  useEffect(() => {
    if (Math.abs(value - emitted.current) > tolerance) { emitted.current = value; setShown(value); }
  }, [value, tolerance]);
  const change = useCallback((next: number) => { emitted.current = next; onChange(next); }, [onChange]);
  return [shown, change] as const;
}
