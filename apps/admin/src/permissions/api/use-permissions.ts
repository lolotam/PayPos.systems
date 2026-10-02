'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  membershipPermissions,
  permissionMembershipPage,
  permissionOverride,
  type PermissionOverrideInput,
} from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';

const key = (companyId: string, userId: string) => ['permissions', companyId, userId] as const;
const header = (companyId: string) => ({ 'x-company-id': companyId });
async function fetchMemberships(
  companyId: string,
  cursor: string | undefined,
  signal: AbortSignal,
) {
  const response = await apiClient().GET('/v1/permissions/memberships', {
    params: { header: header(companyId), query: { limit: 20, ...(cursor ? { cursor } : {}) } },
    signal,
  });
  if (response.error) throw response.error;
  return permissionMembershipPage.parse(response.data);
}
async function fetchPermissions(
  companyId: string,
  membershipId: string,
  cursor: string | undefined,
  signal: AbortSignal,
) {
  const response = await apiClient().GET('/v1/permissions/memberships/{membershipId}', {
    params: {
      header: header(companyId),
      path: { membershipId },
      query: { limit: 20, ...(cursor ? { cursor } : {}) },
    },
    signal,
  });
  if (response.error) throw response.error;
  return membershipPermissions.parse(response.data);
}
async function saveOverride(
  companyId: string,
  membershipId: string,
  body: PermissionOverrideInput,
) {
  const response = await apiClient().POST('/v1/permissions/memberships/{membershipId}/overrides', {
    params: { header: header(companyId), path: { membershipId } },
    body,
  });
  if (response.error) throw response.error;
  return permissionOverride.parse(response.data);
}
export function usePermissionMemberships(companyId: string, userId: string, cursor?: string) {
  return useQuery({
    queryKey: [...key(companyId, userId), 'memberships', cursor],
    queryFn: ({ signal }) => fetchMemberships(companyId, cursor, signal),
    refetchInterval: 30_000,
  });
}
export function usePermissions(
  companyId: string,
  userId: string,
  membershipId: string,
  cursor?: string,
) {
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: [...key(companyId, userId), membershipId, cursor],
    queryFn: ({ signal }) => fetchPermissions(companyId, membershipId, cursor, signal),
    enabled: membershipId !== '',
    refetchInterval: 30_000,
  });
  const save = useMutation({
    mutationFn: (body: PermissionOverrideInput) => saveOverride(companyId, membershipId, body),
    onMutate: () => ({ queryKey: key(companyId, userId) }),
    onSuccess: (_saved, _body, context) => client.invalidateQueries({ queryKey: context.queryKey }),
  });
  return { detail, save };
}
