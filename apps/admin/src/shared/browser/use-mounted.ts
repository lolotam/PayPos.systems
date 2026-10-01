'use client';

import { useSyncExternalStore } from 'react';

function subscribe(): () => void {
  return () => undefined;
}

function onClient(): boolean {
  return true;
}

function onServer(): boolean {
  return false;
}

export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, onClient, onServer);
}
