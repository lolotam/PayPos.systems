'use client';

import { useCallback, useRef, useSyncExternalStore } from 'react';

export function useNavigationMedia(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const media = window.matchMedia(query);
      media.addEventListener('change', callback);
      return () => media.removeEventListener('change', callback);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

type HydratedMediaSnapshot = {
  matches: boolean;
  ready: boolean;
};

const SERVER_MEDIA_SNAPSHOT: HydratedMediaSnapshot = { matches: false, ready: false };

export function useHydratedNavigationMedia(query: string): HydratedMediaSnapshot {
  const snapshotRef = useRef<HydratedMediaSnapshot>(SERVER_MEDIA_SNAPSHOT);
  const subscribe = useCallback(
    (callback: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const media = window.matchMedia(query);
      media.addEventListener('change', callback);
      return () => media.removeEventListener('change', callback);
    },
    [query],
  );
  const getSnapshot = useCallback(() => {
    const matches =
      typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false;
    const snapshot = snapshotRef.current;
    if (!snapshot.ready || snapshot.matches !== matches) {
      snapshotRef.current = { matches, ready: true };
    }
    return snapshotRef.current;
  }, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_MEDIA_SNAPSHOT);
}
