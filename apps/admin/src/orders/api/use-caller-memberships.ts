'use client';
import { myMembershipsResponse } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

async function readOwnMemberships(companyId: string, signal: AbortSignal) {
  const response = await apiClient().GET('/v1/me/memberships', {
    params: { header: { 'x-company-id': companyId } },
    signal,
  });
  if (response.error) throw response.error;
  return myMembershipsResponse.parse(response.data);
}

// حوار إلغاء السطر بيقرأ عضويات المتصل نفسه، مش قائمة صلاحيات الشركة.
export function useCallerMemberships(companyId: string, userId: string) {
  const memberships = useQuery({
    queryKey: ['me', 'memberships', companyId, userId],
    queryFn: ({ signal }) => readOwnMemberships(companyId, signal),
  });
  return { memberships: memberships.data?.items ?? [] };
}
