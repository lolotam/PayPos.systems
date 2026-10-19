'use client';
import { myWorkspacesResponse, permissionMembershipPage } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

// نفس مفتاح شاشة الصلاحيات ومساحات الشِل، عشان التسمية تقرا البيانات الموجودة من غير endpoint جديد.
async function readMemberships(companyId: string, signal: AbortSignal) {
  const response = await apiClient().GET('/v1/permissions/memberships', {
    params: { header: { 'x-company-id': companyId }, query: { limit: 20 } },
    signal,
  });
  if (response.error) throw response.error;
  return permissionMembershipPage.parse(response.data);
}

async function readWorkspaces() {
  const response = await apiClient().GET('/v1/me/workspaces');
  if (response.error) throw response.error;
  return myWorkspacesResponse.parse(response.data);
}

export function useCallerMemberships(companyId: string, userId: string) {
  const memberships = useQuery({
    queryKey: ['permissions', companyId, userId, null, 'memberships', undefined],
    queryFn: ({ signal }) => readMemberships(companyId, signal),
  });
  const workspaces = useQuery({
    queryKey: ['me', 'workspaces'],
    queryFn: readWorkspaces,
  });
  return {
    memberships: memberships.data?.items ?? [],
    companies: workspaces.data?.companies ?? [],
  };
}
