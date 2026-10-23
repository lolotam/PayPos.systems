'use client';

import { useQuery } from '@tanstack/react-query';
import { readStaffColumns, staffColumnsKey } from './staff-columns-client';

export function useStaffColumns(
  companyId: string | undefined,
  userId: string | null,
  businessId: string | undefined,
) {
  return useQuery({
    queryKey: staffColumnsKey(companyId ?? '', userId ?? '', businessId ?? ''),
    enabled: Boolean(companyId && userId && businessId),
    queryFn: ({ signal }) => readStaffColumns(companyId ?? '', businessId ?? '', signal),
    retry: false,
  });
}
