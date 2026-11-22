'use client';

import { useCallback, useRef, useSyncExternalStore } from 'react';

export function useNavigationMedia(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', callback);
      return () => media.removeEventListener('change', callback);
    },
    [query],
  );
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
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
      const media = window.matchMedia(query);
      media.addEventListener('change', callback);
      return () => media.removeEventListener('change', callback);
    },
    [query],
  );
  const getSnapshot = useCallback(() => {
    const matches = window.matchMedia(query).matches;
    const snapshot = snapshotRef.current;
    if (!snapshot.ready || snapshot.matches !== matches) {
      snapshotRef.current = { matches, ready: true };
    }
    return snapshotRef.current;
  }, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_MEDIA_SNAPSHOT);
}
