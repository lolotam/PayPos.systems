'use client';
import type { SessionTips } from '@pospay/contracts';
import { useEffect, useState } from 'react';
import { useSessionTips } from '../api/use-session-tips';
import type { SessionServiceScope } from '../api/use-session-services';

// الكاش القديم مش قراءة الفتحة دي. الفورم يستنى لحد ما الجلب اللي بدأ بعد الفتح يخلّص.
export function useFreshSessionTips(scope: SessionServiceScope, sessionId: string) {
  const query = useSessionTips(scope, sessionId, true, true);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (query.isFetchedAfterMount && query.isSuccess && !query.isFetching) setOpened(true);
  }, [query.isFetchedAfterMount, query.isSuccess, query.isFetching]);
  const loaded: SessionTips | null = opened ? (query.data ?? null) : null;
  return { query, loaded };
}
