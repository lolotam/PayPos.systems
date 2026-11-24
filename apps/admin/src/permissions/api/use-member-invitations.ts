'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

/**
 * قائمة الدعوات بصفحات، وطلبا الدعوة وإعادة الإصدار. الرابط بيرجع من الـ mutation للنداء
 * مباشرة (`mutate(..., { onSuccess })`) والصفحة بتحطه في حالة محلية وبعدها بتعمل reset —
 * مع gcTime: 0 مفيش رابط يفضل في أي كاش، ومفيش مفتاح query فيه رابط ولا توكن.
 */
export function useMemberInvitations(companyId: string, userId: string) {
  const client = useQueryClient();
  const listKey = ['member-invitations', companyId, userId, 'list'] as const;
  const list = useInfiniteQuery({
    queryKey: listKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => fetchInvitations(companyId, pageParam, signal),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const refresh = () => client.invalidateQueries({ queryKey: listKey });
  const invite = useMutation({
    gcTime: 0,
    mutationFn: (body: InviteMemberInput) => postInvitation(companyId, body),
    onSuccess: refresh,
  });
  const reissue = useMutation({
    gcTime: 0,
    mutationFn: (invitationId: string) => postReissue(companyId, invitationId),
    onSuccess: refresh,
  });
  return { list, invite, reissue };
}
