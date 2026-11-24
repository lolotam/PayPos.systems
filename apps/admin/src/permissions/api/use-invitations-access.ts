'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

/** قراءة رخيصة تقول إن مسارات الدعوة متاحة: 200 لما البوابة مفتوحة، و503 NOT_READY وهي مقفولة. */
export function useInvitationsAccess(
  companyId: string | undefined,
  userId: string | null,
  businessSelected = true,
) {
  return useQuery({
    queryKey: ['invitations', 'access', companyId, userId],
    queryFn: async ({ signal }) => {
      const response = await apiClient().GET('/v1/memberships/invitations', {
        params: {
          header: { 'x-company-id': companyId ?? '' },
          query: { limit: 1 },
        },
        signal,
      });
      if (response.error) throw response.error;
      return true;
    },
    enabled: companyId !== undefined && userId !== null && businessSelected,
    staleTime: 30_000,
    retry: false,
  });
}
