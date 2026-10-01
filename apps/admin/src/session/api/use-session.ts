'use client';

import { useQuery } from '@tanstack/react-query';

import { loadBrowserSession, readSessionUserId } from './session-calls';

export function useSession(enabled: boolean) {
  return useQuery({
    queryKey: ['session', 'me'],
    queryFn: loadBrowserSession,
    enabled,
  });
}

export function useSessionUser(enabled: boolean): string | null {
  const query = useQuery({
    queryKey: ['session', 'user'],
    queryFn: readSessionUserId,
    enabled,
  });
  return enabled && query.isSuccess ? query.data : null;
}
