import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { leaveReadRefused, leaveSessionRefused } from '../model/read-error';

export function useForgetRefusedRead(
  error: unknown,
  identity: string,
  branch: string,
  sessionRefused?: ((error: unknown) => void) | undefined,
) {
  const cache = useQueryClient();
  useEffect(() => {
    forgetRefusedLeaveData(cache, error, { identity, branch, sessionRefused });
  }, [cache, error, identity, branch, sessionRefused]);
}

export function forgetRefusedLeaveData(
  cache: QueryClient,
  error: unknown,
  scope: {
    identity: string;
    branch: string;
    sessionRefused?: ((error: unknown) => void) | undefined;
  },
) {
  // رفض الجلسة يشمل بيانات الفروع؛ رفض فرع واحد لا يلغي سلطة بقية الفروع.
  if (leaveSessionRefused(error)) {
    cache.removeQueries({ queryKey: ['my-leave', scope.identity] });
    scope.sessionRefused?.(error);
  } else if (leaveReadRefused(error)) {
    cache.removeQueries({ queryKey: ['my-leave', scope.identity, scope.branch], exact: true });
  }
}
