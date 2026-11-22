'use client';

import type { InAppNotification } from '@pospay/contracts';
import { employeeDocumentNumbers } from '@pospay/contracts';
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { documentIdOf, type DocumentNumbersByBusiness } from '../model/render-notification';

// أرقام المستندات في الذاكرة فقط ما دام الجرس مفتوحاً: الإغلاق أو تغيّر الهوية أو النشاط أو مجموعة المعرّفات
// يلغي الطلب ويحذف القيم، والنتائج المتأخرة تُهمل، وأي فشل أو انتظار يعيد نص اليوم (62-2e، FR-D09).
// كل نشاط بطلبه المستقل: رفض نشاط واحد (سحب صلاحية مثلًا) ما يخفيش أرقام الأنشطة الأخرى المصرّح بها.

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

const noNumbers: DocumentNumbersByBusiness = new Map();

/** أنشطة الأجراس المفتوحة التي تحتاج أرقامًا: نشاط + معرّفاته الحالية مرتّبة. */
interface DocumentNumberScope {
  readonly businessId: string;
  readonly ids: string;
}

/** يجمّع أرقام المستندات المطلوبة من عناصر الجرس، لكل نشاط معرّفاته الحالية بحروف صغيرة. */
function numberScopes(
  inboxRead: number | null,
  items: readonly InAppNotification[],
): DocumentNumberScope[] {
  const byBusiness = new Map<string, Set<string>>();
  if (inboxRead === null) return [];
  for (const item of items) {
    if (item.template_key !== 'document_expiring' || item.business_id === null) continue;
    const id = documentIdOf(item);
    if (id === null) continue;
    const ids = byBusiness.get(item.business_id) ?? new Set<string>();
    ids.add(id.toLowerCase());
    byBusiness.set(item.business_id, ids);
  }
  return [...byBusiness.entries()]
    .map(([businessId, ids]) => ({ businessId, ids: [...ids].sort().join(',') }))
    .sort((a, b) => a.businessId.localeCompare(b.businessId));
}

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
}): DocumentNumbersByBusiness {
  const scopes = useMemo(() => numberScopes(inboxRead, items), [inboxRead, items]);
  const enabled =
    inboxRead !== null && scopes.length > 0 && companyId !== undefined && userId !== null;
  // استعلام مستقل لكل نشاط: رفض نشاط واحد يخفي أرقامه هو فقط، والأرقام المتحقق منها تبقى ظاهرة.
  const queries = useQueries({
    queries: scopes.map((scope) => ({
      queryKey: [
        'me',
        'document-numbers',
        companyId,
        userId,
        businessId,
        inboxRead,
        scope.businessId,
        scope.ids,
      ],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchBusinessNumbers(companyId, scope.businessId, scope.ids.split(','), signal),
      enabled,
      retry: false,
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: 'always',
    })),
  });
  return useMemo(() => {
    if (!enabled) return noNumbers;
    const byBusiness = new Map<string, ReadonlyMap<string, string>>();
    for (const [index, scope] of scopes.entries()) {
      const query = queries[index];
      if (!query?.isSuccess || !query.isFetchedAfterMount || query.fetchStatus !== 'idle') continue;
      byBusiness.set(scope.businessId, query.data);
    }
    return byBusiness;
  }, [scopes, queries, enabled]);
}
