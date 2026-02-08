import { useCallback, useEffect, useRef } from 'react';

type Options = {
  intervalMs?: number;
  jitterPct?: number;
  onVersionChange: () => void;
};

function withJitter(base: number, jitterPct: number) {
  if (jitterPct <= 0) return base;
  const delta = base * jitterPct;
  const jitter = Math.random() * delta * 2 - delta; // [-delta, +delta]
  return Math.max(1000, base + jitter);
}

export function useDevicesVersionPolling({ intervalMs = 15000, jitterPct = 0.1, onVersionChange }: Options) {
  const latestVersionRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  const scheduleNext = useCallback(
    (runner: () => void, base = intervalMs) => {
      if (stoppedRef.current) return;
      const ms = withJitter(base, jitterPct);
      timerRef.current = setTimeout(runner, ms);
    },
    [intervalMs, jitterPct]
  );

  const run = useCallback(async () => {
    try {
      const res = await fetch('/api/devices/version', { credentials: 'include', cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        stoppedRef.current = true;
        return;
      }
      const data = await res.json().catch(() => null);
      const nextVersion = typeof data?.devicesVersion === 'number' ? data.devicesVersion : null;
      if (nextVersion !== null && nextVersion !== latestVersionRef.current) {
        latestVersionRef.current = nextVersion;
        onVersionChange();
      }
    } catch {
      // ignore transient errors; retry on next tick
    } finally {
      scheduleNext(run);
    }
  }, [onVersionChange, scheduleNext]);

  useEffect(() => {
    stoppedRef.current = false;
    latestVersionRef.current = null;
    scheduleNext(run, 1000); // start quickly
    return () => {
      stoppedRef.current = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [run, scheduleNext]);
}
