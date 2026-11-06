import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { leaveReadRefused } from '../model/read-error';

export function useForgetRefusedRead(error: unknown, identity: string, branch: string) {
  const cache = useQueryClient();
  useEffect(() => {
    // الرفض يزيل حتى الصفحات المخزنة؛ الخطأ العابر وحده يسمح بالاحتفاظ بالمسودة.
    if (leaveReadRefused(error))
      cache.removeQueries({ queryKey: ['my-leave', identity, branch], exact: true });
  }, [cache, error, identity, branch]);
}
