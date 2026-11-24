'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export function useMemberInvitations(companyId: string, userId: string) {
  const client = useQueryClient();
  const key = ['member-invitations', companyId, userId] as const;
  const query = useQuery({
    queryKey: [...key, 'list', 'first'],
    queryFn: ({ signal }) => fetchInvitations(companyId, undefined, signal),
    refetchInterval: 30_000,
  });
  const invite = useMutation({
    // gcTime: 0 + reset بعد القراءة: الرابط بيتسلّم للنداء مرة واحدة ولا بيرجع من أي كاش.
    gcTime: 0,
    mutationFn: (body: InviteMemberInput) => postInvitation(companyId, body),
    onSuccess: () => client.invalidateQueries({ queryKey: [...key, 'list'] }),
  });
  const reissue = useMutation({
    gcTime: 0,
    mutationFn: (invitationId: string) => postReissue(companyId, invitationId),
    onSuccess: () => client.invalidateQueries({ queryKey: [...key, 'list'] }),
  });
  return { query, invite, reissue };
}

/** بيجيب صفحة تالية بالـ cursor — بتستدعى من زر «تحميل المزيد» في الجدول. */
export async function fetchInvitationsPage(companyId: string, cursor: string) {
  return fetchInvitations(companyId, cursor, new AbortController().signal);
}
