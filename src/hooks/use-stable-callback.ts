import { useCallback, useLayoutEffect, useRef } from 'react';

/** Stable event identity for memoized rows, with the latest committed state. */
export function useStableCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const latest = useRef(callback);
  useLayoutEffect(() => { latest.current = callback; }, [callback]);
  return useCallback((...args: Args) => latest.current(...args), []);
}
