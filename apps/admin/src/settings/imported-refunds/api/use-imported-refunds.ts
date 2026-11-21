'use client';

import { useQuery } from '@tanstack/react-query';

import { importedRefundsKey, readImportedRefunds } from './imported-refunds-client';

export function useImportedRefunds(
  companyId: string | undefined,
  userId: string | null,
  businessId: string | undefined,
) {
  return useQuery({
    queryKey: importedRefundsKey(companyId ?? '', userId ?? '', businessId ?? ''),
    enabled: Boolean(companyId && userId && businessId),
    queryFn: ({ signal }) => readImportedRefunds(companyId ?? '', businessId ?? '', signal),
    retry: false,
  });
}
