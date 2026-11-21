'use client';

import type { InAppNotification } from '@pospay/contracts';
import { employeeDocumentNumbers } from '@pospay/contracts';
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { documentIdOf } from '../model/render-notification';

// أرقام المستندات في الذاكرة فقط ما دام الجرس مفتوحاً: الإغلاق أو تغيّر الهوية أو النشاط أو مجموعة المعرّفات
// يلغي الطلب ويحذف القيم، والنتائج المتأخرة تُهمل، وأي فشل أو انتظار يعيد نص اليوم (62-2e، FR-D09).

async function fetchBusinessNumbers(
  companyId: string | undefined,
  businessId: string,
  ids: readonly string[],
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const { data, error } = await apiClient().GET(
    '/v1/businesses/{businessId}/employee-document-numbers',
    {
      params: {
        header: { 'x-company-id': companyId ?? '' },
        path: { businessId },
        query: { ids: ids.join(',') },
      },
      signal,
    },
  );
  if (error) throw error;
  const parsed = employeeDocumentNumbers.parse(data);
  const numbers = new Map<string, string>();
  for (const row of parsed.items) numbers.set(row.document_id.toLowerCase(), row.document_number);
  return numbers;
}

export function useDocumentNumbers(
  companyId: string | undefined,
  userId: string | null,
  open: boolean,
  items: readonly InAppNotification[],
): Map<string, string> {
  const client = useQueryClient();
  const targets = useMemo(() => {
    const byBusiness = new Map<string, Set<string>>();
    if (!open) return byBusiness;
    for (const item of items) {
      if (item.template_key !== 'document_expiring' || item.business_id === null) continue;
      const id = documentIdOf(item);
      if (id === null) continue;
      const ids = byBusiness.get(item.business_id) ?? new Set<string>();
      ids.add(id.toLowerCase());
      byBusiness.set(item.business_id, ids);
    }
    return byBusiness;
  }, [open, items]);
  const scope =
    targets.size === 0
      ? null
      : [...targets.entries()]
          .map(([businessId, ids]) => `${businessId}:${[...ids].sort().join(',')}`)
          .sort()
          .join('|');
  useEffect(() => {
    if (!open) client.removeQueries({ queryKey: ['me', 'document-numbers'] });
  }, [open, client]);
  const query = useQuery({
    queryKey: ['me', 'document-numbers', companyId, userId, scope],
    queryFn: async ({ signal }) => {
      const numbers = new Map<string, string>();
      await Promise.all(
        [...targets.entries()].map(async ([businessId, ids]) => {
          const rows = await fetchBusinessNumbers(companyId, businessId, [...ids], signal);
          for (const [id, number] of rows) numbers.set(id, number);
        }),
      );
      return numbers;
    },
    enabled: open && scope !== null && companyId !== undefined && userId !== null,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });
  return open && query.data !== undefined ? query.data : new Map<string, string>();
}
