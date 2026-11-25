'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

/**
 * قراءة رخيصة تقول إن مسارات الدعوة متاحة: 200 لما البوابة مفتوحة، و503 NOT_READY وهي مقفولة.
 * المصدر بيفصل بين قراءة المدخل وقراءة الصفحة: كل واحدة بمفتاح استعلام لوحدها، فصفحة
 * اتفتحت بعد المدخل ما بتستعيرش إجابة المدخل المخزّنة (AC-ACT-22).
 */
export function useInvitationsAccess(
  companyId: string | undefined,
  userId: string | null,
  businessSelected = true,
  source: 'menu' | 'page' = 'menu',
) {
  return useQuery({
    queryKey:
      source === 'page'
        ? ['invitations', 'access', companyId, userId, 'page']
        : ['invitations', 'access', companyId, userId],
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
