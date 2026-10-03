'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  membershipPermissions,
  permissionMembershipPage,
  permissionOverride,
  type PermissionOverrideInput,
  type RevokePermissionOverrideInput,
} from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';

const key = (companyId: string, userId: string, businessId?: string) =>
  ['permissions', companyId, userId, businessId ?? null] as const;
const header = (companyId: string) => ({ 'x-company-id': companyId });
async function fetchMemberships(
  companyId: string,
  cursor: string | undefined,
  signal: AbortSignal,
  businessId?: string,
) {
  const response = await apiClient().GET(
    businessId === undefined
      ? '/v1/permissions/memberships'
      : '/v1/businesses/{businessId}/permissions/memberships',
    {
      params: {
        path: { businessId: businessId ?? '' },
        header: header(companyId),
        query: { limit: 20, ...(cursor ? { cursor } : {}) },
      },
      signal,
    },
  );
  if (response.error) throw response.error;
  return permissionMembershipPage.parse(response.data);
}
async function fetchPermissions(
  companyId: string,
  membershipId: string,
  cursor: string | undefined,
  signal: AbortSignal,
  historyCursor: string | undefined,
  businessId?: string,
) {
  const response = await apiClient().GET(
    businessId === undefined
      ? '/v1/permissions/memberships/{membershipId}'
      : '/v1/businesses/{businessId}/permissions/memberships/{membershipId}',
    {
      params: {
        header: header(companyId),
        path: { membershipId, businessId: businessId ?? '' },
        query: {
          limit: 20,
          ...(cursor ? { cursor } : {}),
          ...(historyCursor ? { history_cursor: historyCursor } : {}),
        },
      },
      signal,
    },
  );
  if (response.error) throw response.error;
  return membershipPermissions.parse(response.data);
}
async function revokeOverride(
  companyId: string,
  membershipId: string,
  overrideId: string,
  body: RevokePermissionOverrideInput,
  businessId?: string,
) {
  const response = await apiClient().POST(
    businessId === undefined
      ? '/v1/permissions/memberships/{membershipId}/overrides/{overrideId}/revoke'
      : '/v1/businesses/{businessId}/permissions/memberships/{membershipId}/overrides/{overrideId}/revoke',
    {
      params: {
        header: header(companyId),
        path: { membershipId, overrideId, businessId: businessId ?? '' },
      },
      body,
    },
  );
  if (response.error) throw response.error;
  return permissionOverride.parse(response.data);
}
async function saveOverride(
  companyId: string,
  membershipId: string,
  body: PermissionOverrideInput,
  businessId?: string,
) {
  const response = await apiClient().POST(
    businessId === undefined
      ? '/v1/permissions/memberships/{membershipId}/overrides'
      : '/v1/businesses/{businessId}/permissions/memberships/{membershipId}/overrides',
    {
      params: { header: header(companyId), path: { membershipId, businessId: businessId ?? '' } },
      body,
    },
  );
  if (response.error) throw response.error;
  return permissionOverride.parse(response.data);
}
export function usePermissionMemberships(
  companyId: string,
  userId: string,
  cursor?: string,
  businessId?: string,
) {
  return useQuery({
    queryKey: [...key(companyId, userId, businessId), 'memberships', cursor],
    queryFn: ({ signal }) => fetchMemberships(companyId, cursor, signal, businessId),
    refetchInterval: 30_000,
  });
}
export function usePermissions(
  companyId: string,
  userId: string,
  membershipId: string,
  cursor?: string,
  historyCursor?: string,
  businessId?: string,
) {
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: [...key(companyId, userId, businessId), membershipId, cursor, historyCursor],
    queryFn: ({ signal }) =>
      fetchPermissions(companyId, membershipId, cursor, signal, historyCursor, businessId),
    enabled: membershipId !== '',
    refetchInterval: 30_000,
  });
  const save = useMutation({
    mutationFn: (body: PermissionOverrideInput) =>
      saveOverride(companyId, membershipId, body, businessId),
    onMutate: () => ({ queryKey: key(companyId, userId, businessId) }),
    onSuccess: (_saved, _body, context) => client.invalidateQueries({ queryKey: context.queryKey }),
  });
  const revoke = useMutation({
    mutationFn: ({ overrideId, reason }: { overrideId: string; reason: string }) =>
      revokeOverride(companyId, membershipId, overrideId, { reason }, businessId),
    onMutate: () => ({ queryKey: key(companyId, userId, businessId) }),
    onSuccess: (_saved, _body, context) => client.invalidateQueries({ queryKey: context.queryKey }),
  });
  return { detail, save, revoke };
}
