'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchStatement, statementKey, type StatementScope } from './commission-statement-client';

/**
 * كشف شهر واحد: بلا إعادة محاولة تلقائية وبلا بقاء في الكاش بعد آخر مستمع، لأن الأرقام والبصمات
 * بتتغيّر والمراجعة لازم تكون على أحدث نسخة. الفشل بيتعرض ومعاه زرار «جرّب تاني» بدل حلقة طلبات.
 */
export function useCommissionStatement(scope: StatementScope, period: string) {
  return useQuery({
    queryKey: statementKey(scope, period),
    queryFn: ({ signal }) => fetchStatement(scope, period, signal),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

/** 403 بكود FORBIDDEN على القراءة معناه مفيش صلاحية؛ FEATURE_DISABLED وغيره بيتعرض كخطأ عادي برسالته. */
export function isStatementDenied(error: unknown): boolean {
  const body = error as { status?: unknown; code?: unknown } | null;
  return body?.status === 403 && body.code === 'FORBIDDEN';
}
