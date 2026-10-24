'use client';

import { useQuery } from '@tanstack/react-query';
import { alertRulesKey, readAlertRules } from './alert-rules-client';

export function useAlertRules(
  companyId: string | undefined,
  userId: string | null,
  businessId: string | undefined,
  branchId: string | null = null,
) {
  return useQuery({
    queryKey: alertRulesKey(companyId ?? '', userId ?? '', businessId ?? '', branchId),
    enabled: Boolean(companyId && userId && businessId),
    queryFn: ({ signal }) => readAlertRules(companyId ?? '', businessId ?? '', branchId, signal),
    retry: false,
  });
}
