'use client';

import { useQuery } from '@tanstack/react-query';

import { loadBrowserSession } from './session-calls';

export function useSession(enabled: boolean) {
  return useQuery({
    queryKey: ['session', 'me'],
    queryFn: loadBrowserSession,
    enabled,
  });
}
