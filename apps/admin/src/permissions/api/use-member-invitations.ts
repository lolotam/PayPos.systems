'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { memberInvitationPage, type InviteMemberInput } from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';

const header = (companyId: string) => ({ 'x-company-id': companyId });

async function fetchInvitations(
  companyId: string,
  cursor: string | undefined,
  signal: AbortSignal,
) {
  const response = await apiClient().GET('/v1/memberships/invitations', {
    params: { header: header(companyId), query: { limit: 20, ...(cursor ? { cursor } : {}) } },
    signal,
  });
  if (response.error) throw response.error;
  return memberInvitationPage.parse(response.data);
}

async function postInvitation(companyId: string, body: InviteMemberInput) {
  const response = await apiClient().POST('/v1/memberships/invitations', {
    params: { header: header(companyId) },
    body,
  });
  if (response.error) throw response.error;
  return response.data;
}

async function postReissue(companyId: string, invitationId: string) {
  const response = await apiClient().POST('/v1/memberships/invitations/{invitationId}/link', {
    params: { header: header(companyId), path: { invitationId } },
  });
  if (response.error) throw response.error;
  return response.data;
}

/** حالة نداء مباشر: تحميل وخطأ بس. الوسائط والنتيجة بتعدي على المتصل ومبتتخزنش في أي كاش. */
export interface DirectCall<Args extends unknown[], Result> {
  readonly pending: boolean;
  readonly error: unknown;
  /** بينفّذ النداء؛ بيرجّع النتيجة أو null لما فشل (والخطأ في `error`). */
  run(...args: Args): Promise<Result | null>;
}

function useDirectCall<Args extends unknown[], Result>(
  call: (...args: Args) => Promise<Result>,
  onDone: () => void,
): DirectCall<Args, Result> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (...args: Args): Promise<Result | null> => {
    setPending(true);
    setError(null);
    try {
      const result = await call(...args);
      onDone();
      return result;
    } catch (failure) {
      setError(failure);
      return null;
    } finally {
      setPending(false);
    }
  };
  return { pending, error, run };
}

/**
 * قائمة الدعوات بصفحات، وطلبا الدعوة وإعادة الإصدار. الطلبين نداء مباشر (من غير useMutation):
 * useMutation بيمسك الوسائط (الإيميل) في `variables` من أول الطلب والنتيجة (الرابط) في `data`
 * في كاش الـ mutations لحد ما ينضف، فالإيميل والرابط ما بيعدوش على غير الدالة اللي نادت والحالة
 * المحلية في الصفحة. مفيش مفتاح query فيه رابط ولا توكن.
 */
export function useMemberInvitations(companyId: string, userId: string, enabled = true) {
  const client = useQueryClient();
  const listKey = ['member-invitations', companyId, userId, 'list'] as const;
  const list = useInfiniteQuery({
    queryKey: listKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => fetchInvitations(companyId, pageParam, signal),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: listKey });
  };
  const invite = useDirectCall((body: InviteMemberInput) => postInvitation(companyId, body), refresh);
  const reissue = useDirectCall(
    (invitationId: string) => postReissue(companyId, invitationId),
    refresh,
  );
  return { list, invite, reissue };
}
