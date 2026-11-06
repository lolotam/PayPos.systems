import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { announceOperatorChange, observeOperatorChange } from '../model/operator-change';
import { probeStaffSession, signOutStaff } from './staff-calls';
import { useSessionDeadline } from '@/shared/api/use-session-deadline';

export function useStaffLogin() {
  const cache = useQueryClient();
  const [epoch, setEpoch] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const clear = useCallback(() => {
    cache.clear();
    setEpoch((value) => value + 1);
  }, [cache]);
  useEffect(() => observeOperatorChange(clear), [clear]);
  useEffect(() => {
    const changed = () => {
      setOnline(navigator.onLine);
      clear();
    };
    window.addEventListener('online', changed);
    window.addEventListener('offline', changed);
    return () => {
      window.removeEventListener('online', changed);
      window.removeEventListener('offline', changed);
    };
  }, [clear]);
  const session = useQuery({
    queryKey: ['staff-session', epoch],
    queryFn: probeStaffSession,
    enabled: online,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
  usePrivateCacheCleanup(cache, session.isSuccess, session.data, epoch);
  const changed = () => {
    announceOperatorChange();
    clear();
  };
  const live = useSessionDeadline(session.data?.expires_at, clear);
  return {
    online,
    epoch,
    loading: online && session.isPending,
    session: online && live && session.isSuccess && !session.isFetching ? session.data : null,
    authenticatedSession: online && live ? (session.data ?? null) : null,
    changed,
    signOut: async () => {
      await signOutStaff();
      changed();
    },
  };
}

function usePrivateCacheCleanup(
  cache: QueryClient,
  isSuccess: boolean,
  data: unknown,
  epoch: number,
) {
  useEffect(() => {
    if (!(isSuccess && data === null)) return;
    const privateQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== 'staff-session',
    };
    const owner = cache.getQueryCache().find({ queryKey: ['staff-session', epoch], exact: true });
    void cache.cancelQueries(privateQueries).then(() => {
      if (
        owner &&
        cache.getQueryCache().find({ queryKey: ['staff-session', epoch], exact: true }) === owner &&
        owner.state.data === null
      )
        cache.removeQueries(privateQueries);
    });
  }, [cache, isSuccess, data, epoch]);
}
