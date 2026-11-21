'use client';

import type { InAppNotification } from '@pospay/contracts';
import { employeeDocumentNumbers } from '@pospay/contracts';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
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

async function fetchInboxNumbers(
  companyId: string | undefined,
  targets: ReadonlyMap<string, ReadonlySet<string>>,
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const group = new AbortController();
  const abort = () => group.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  const numbers = new Map<string, string>();
  try {
    await Promise.all(
      [...targets.entries()].map(async ([businessId, ids]) => {
        const rows = await fetchBusinessNumbers(companyId, businessId, [...ids], group.signal);
        for (const [id, number] of rows) numbers.set(id, number);
      }),
    );
    return numbers;
  } finally {
    // لو طلب فشل، نلغي باقي طلبات نفس الدفعة قبل ما الاستعلام ينتهي.
    group.abort();
    signal.removeEventListener('abort', abort);
  }
}

const noNumbers: ReadonlyMap<string, string> = new Map();

export function useDocumentNumbers({
  companyId,
  userId,
  businessId,
  inboxRead,
  items,
}: {
  companyId: string | undefined;
  userId: string | null;
  businessId: string | undefined;
  inboxRead: number | null;
  items: readonly InAppNotification[];
}): ReadonlyMap<string, string> {
  const targets = useMemo(() => {
    const byBusiness = new Map<string, Set<string>>();
    if (inboxRead === null) return byBusiness;
    for (const item of items) {
      if (item.template_key !== 'document_expiring' || item.business_id === null) continue;
      const id = documentIdOf(item);
      if (id === null) continue;
      const ids = byBusiness.get(item.business_id) ?? new Set<string>();
      ids.add(id.toLowerCase());
      byBusiness.set(item.business_id, ids);
    }
    return byBusiness;
  }, [inboxRead, items]);
  const scope =
    targets.size === 0
      ? null
      : [...targets.entries()]
          .map(([businessId, ids]) => `${businessId}:${[...ids].sort().join(',')}`)
          .sort()
          .join('|');
  const enabled =
    inboxRead !== null && scope !== null && companyId !== undefined && userId !== null;
  const query = useQuery({
    queryKey: ['me', 'document-numbers', companyId, userId, businessId, inboxRead, scope],
    queryFn: ({ signal }) => fetchInboxNumbers(companyId, targets, signal),
    enabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });
  // المفتاح الجديد يفصل المراقب عن النتيجة القديمة ويلغي طلبها؛ نخفي الرقم أثناء أي إعادة تحقق.
  return enabled && query.isSuccess && query.isFetchedAfterMount && query.fetchStatus === 'idle'
    ? query.data
    : noNumbers;
}
