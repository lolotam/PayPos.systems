import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { announcePersonalChange, observePersonalChange } from '../model/session-change';
import { personalCalls } from './personal-calls';

export function usePersonalSession() {
  const cache = useQueryClient();
  const [epoch, setEpoch] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const clear = useCallback(() => {
    cache.clear();
    setEpoch((value) => value + 1);
  }, [cache]);
  useEffect(() => observePersonalChange(clear), [clear]);
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
  const query = useQuery({
    queryKey: ['personal-session', epoch],
    queryFn: personalCalls.session,
    enabled: online,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 15000,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
  useEffect(() => {
    if (!(query.isSuccess && query.data === null)) return;
    const privateQueries = {
      predicate: (item: { queryKey: readonly unknown[] }) =>
        item.queryKey[0] !== 'personal-session',
    };
    void cache.cancelQueries(privateQueries).then(() => cache.removeQueries(privateQueries));
  }, [cache, query.isSuccess, query.data]);
  return {
    epoch,
    online,
    loading: online && query.isPending,
    // الجلب الدوري يحتفظ بالجلسة المؤكدة؛ فشل الشبكة وحده لا يلغي إثباتاً صالحاً.
    session: online ? (query.data ?? null) : null,
    changed: () => {
      announcePersonalChange();
      clear();
    },
    signOut: async () => {
      try {
        await personalCalls.signOut();
      } finally {
        announcePersonalChange();
        clear();
      }
    },
  };
}
