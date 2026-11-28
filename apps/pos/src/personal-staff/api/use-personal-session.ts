import type { QueryClient } from '@tanstack/react-query';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { announcePersonalChange, observePersonalChange } from '../model/session-change';
import { disablePushOnSignOut } from '../push/push-disable';
import { personalCalls } from './personal-calls';
import { useSessionDeadline } from '@/shared/api/use-session-deadline';

function usePersonalInvalidation(
  cache: QueryClient,
  setEpoch: Dispatch<SetStateAction<number>>,
  setOnline: Dispatch<SetStateAction<boolean>>,
) {
  const selfAnnouncing = useRef(false);
  const clear = useCallback(() => {
    cache.clear();
    setEpoch((value) => value + 1);
  }, [cache, setEpoch]);
  useEffect(
    () =>
      observePersonalChange(() => {
        if (selfAnnouncing.current) return;
        clear();
      }),
    [clear],
  );
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
  }, [clear, setOnline]);
  const announceAndClear = useCallback(() => {
    selfAnnouncing.current = true;
    try {
      announcePersonalChange();
    } finally {
      selfAnnouncing.current = false;
    }
    clear();
  }, [clear]);
  return { clear, announceAndClear };
}

export function usePersonalSession() {
  const cache = useQueryClient();
  const [epoch, setEpoch] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const { clear, announceAndClear } = usePersonalInvalidation(cache, setEpoch, setOnline);
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
  usePrivateCacheCleanup(cache, query.isSuccess, query.data, epoch);
  const live = useSessionDeadline(query.data?.expires_at, clear);
  return {
    epoch,
    online,
    ...(online && live && query.data != null ? { privateReady: true as const } : {}),
    loading: online && query.isPending,
    // فشل القراءة أو إعادة الجلب مش إثبات إن مفيش جلسة؛ التأكيد بيكون بجواب ناجح مكتمل بس.
    confirmedNoSession: online && query.isSuccess && !query.isFetching && query.data === null,
    // الجلب الدوري يحتفظ بالجلسة المؤكدة؛ فشل الشبكة وحده لا يلغي إثباتاً صالحاً.
    session: online && live ? (query.data ?? null) : null,
    changed: announceAndClear,
    signOut: async () => {
      // الخروج الصريح بيشيل اشتراك الإشعارات من الموبايل؛ التنظيف نفسه ما بيمنعش الخروج (ADR-0052 §7).
      await disablePushOnSignOut();
      try {
        await personalCalls.signOut();
      } finally {
        announceAndClear();
      }
    },
  };
}

function usePrivateCacheCleanup(
  cache: QueryClient,
  isSuccess: boolean,
  data: unknown,
  epoch: number,
): void {
  useEffect(() => {
    if (!(isSuccess && data === null)) return;
    const privateQueries = {
      predicate: (item: { queryKey: readonly unknown[] }) =>
        item.queryKey[0] !== 'personal-session',
    };
    const owner = cache
      .getQueryCache()
      .find({ queryKey: ['personal-session', epoch], exact: true });
    void cache.cancelQueries(privateQueries).then(() => {
      if (
        owner &&
        cache.getQueryCache().find({ queryKey: ['personal-session', epoch], exact: true }) ===
          owner &&
        owner.state.data === null
      )
        cache.removeQueries(privateQueries);
    });
  }, [cache, isSuccess, data, epoch]);
}
