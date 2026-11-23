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

function useSessionAccountQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['session', 'user'],
    queryFn: readSessionAccount,
    enabled,
    // الهوية بتتقرا تاني كل ما التبويب يرجع للواجهة: لو حساب تاني دخل من تبويب تاني، الإشعارات بتتبدل لمفتاحه
    // حتى لو رسالة تغيير الهوية ما وصلتش.
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
}

export function useSessionAccount(enabled: boolean): SessionAccount | null {
  const query = useSessionAccountQuery(enabled);
  return enabled && query.isSuccess ? query.data : null;
}

/**
 * معرّف المستخدم مع حال قراءة هويته: `pending` قبل التركيب أو أثناء القراءة، و`failed` إن فشلت أو أوقفها
 * انقطاع الاتصال قبل أن تبدأ ولا بيانات لها (تستأنف عند عودته)، و`settled` بعد نجاحها (ويبقى المعرّف فارغًا
 * إن لم يكن هناك مستخدم). null وحده لا يفرّق بينها.
 */
export function useSessionIdentity(enabled: boolean): {
  userId: string | null;
  status: 'pending' | 'failed' | 'settled';
} {
  const query = useSessionAccountQuery(enabled);
  const pausedWithoutData = query.fetchStatus === 'paused' && query.data === undefined;
  const failed = enabled && (query.isError || pausedWithoutData);
  const settled = enabled && query.isSuccess;
  return {
    userId: settled ? (query.data?.id ?? null) : null,
    status: failed ? 'failed' : settled ? 'settled' : 'pending',
  };
}

export function useSessionUser(enabled: boolean): string | null {
  return useSessionAccount(enabled)?.id ?? null;
}
