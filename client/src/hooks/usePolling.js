import { useEffect, useRef, useCallback } from 'react';

export function usePolling(fn, intervalMs, { immediate = true, enabled = true } = {}) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const run = useCallback(() => {
    if (enabledRef.current) {
      fnRef.current();
    }
  }, []);

  useEffect(() => {
    if (immediate) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(run, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled, run]);

  return { refresh: run };
}
