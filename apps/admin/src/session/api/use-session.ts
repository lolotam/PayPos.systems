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
    // الهوية بتتقرا تاني كل ما التبويب يرجع للواجهة: لو حساب تاني دخل من تبويب تاني، الإشعارات بتتبدل لمفتاحه
    // حتى لو رسالة تغيير الهوية ما وصلتش.
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
  return enabled && query.isSuccess ? query.data : null;
}
