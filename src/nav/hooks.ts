import { navigationStore } from '@/nav/store';
import type { NavigationFrame, NavigationEvent, TrajectoryPoint } from '@/types/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * React bindings to the high-frequency store.
 *
 * The important one is `useTelemetry`: it returns the newest frame but limits
 * how often React actually re-renders, so a 50 Hz stream drives a 10 Hz text
 * readout while the map canvas keeps its own 60 fps loop. Getting this wrong is
 * the single easiest way to make a dashboard like this jank.
 */

/** Subscribe to the store and re-render at most every `intervalMs`. */
export function useStoreTick(intervalMs = 100): number {
  const [, force] = useState(0);
  const last = useRef(0);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    const schedule = () => {
      const now = performance.now();
      const wait = Math.max(0, intervalMs - (now - last.current));
      if (pending.current !== null) return;
      pending.current = window.setTimeout(() => {
        pending.current = null;
        last.current = performance.now();
        force((n) => n + 1);
      }, wait);
    };
    const off = navigationStore.subscribe(schedule);
    schedule();
    return () => {
      off();
      if (pending.current !== null) window.clearTimeout(pending.current);
      pending.current = null;
    };
  }, [intervalMs]);

  return last.current;
}

/**
 * The newest navigation frame, re-rendering at `intervalMs`.
 * Returns null only before the very first frame arrives.
 */
export function useTelemetry(intervalMs = 100): NavigationFrame | null {
  useStoreTick(intervalMs);
  return navigationStore.frame;
}

/** Live trajectory paths. Arrays are mutated in place; read-only by contract. */
export function useTrajectories(intervalMs = 250): {
  navris: TrajectoryPoint[];
  gnss: TrajectoryPoint[];
} {
  useStoreTick(intervalMs);
  return { navris: navigationStore.navrisPath, gnss: navigationStore.gnssPath };
}

/** The event timeline, newest first. Re-renders only when a new event lands. */
export function useEvents(): NavigationEvent[] {
  const [events, setEvents] = useState<NavigationEvent[]>(() => navigationStore.events);
  useEffect(() => {
    const sync = () => setEvents([...navigationStore.events]);
    const off = navigationStore.subscribe(sync);
    return off;
  }, []);
  return events;
}

/**
 * A live-snapshot hook for components that must animate at frame rate without
 * re-rendering: they get a stable getter they can call inside rAF.
 */
export function useLiveGetter<T>(getter: () => T): () => T {
  const ref = useRef(getter);
  ref.current = getter;
  return useCallback(() => ref.current(), []);
}
