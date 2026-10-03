'use client';

import { useQuery } from '@tanstack/react-query';

import { loadBrowserSession } from './session-calls';
import { readSessionAccount, type SessionAccount } from './session-account';

export function useSession(enabled: boolean) {
  return useQuery({
    queryKey: ['session', 'me'],
    queryFn: loadBrowserSession,
    enabled,
  });
}

export function useSessionAccount(enabled: boolean): SessionAccount | null {
  const query = useQuery({
    queryKey: ['session', 'user'],
    queryFn: readSessionAccount,
    enabled,
    // الهوية بتتقرا تاني كل ما التبويب يرجع للواجهة: لو حساب تاني دخل من تبويب تاني، الإشعارات بتتبدل لمفتاحه
    // حتى لو رسالة تغيير الهوية ما وصلتش.
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
  return enabled && query.isSuccess ? query.data : null;
}

export function useSessionUser(enabled: boolean): string | null {
  return useSessionAccount(enabled)?.id ?? null;
}
