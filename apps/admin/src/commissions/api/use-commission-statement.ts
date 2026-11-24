'use client';

import { queryOptions, useQuery } from '@tanstack/react-query';
import { fetchStatement, statementKey, type StatementScope } from './commission-statement-client';

/**
 * قراءة كشف شهر واحد، بنفس الخيارات للشاشة وللقراءة الطازجة قبل كل أمر كتابة، فرفض القراءة (403 أو 404)
 * بيوصل لحالة الاستعلام اللي الصفحة بتبني عليها. بلا إعادة محاولة وبلا بقاء في الكاش بعد آخر مستمع، لأن
 * الأرقام والبصمات بتتغيّر؛ و`networkMode: 'always'` عشان القراءة ما تتأجّلش وراء انقطاع الشبكة.
 */
export function statementQueryOptions(scope: StatementScope, period: string) {
  return queryOptions({
    queryKey: statementKey(scope, period),
    queryFn: ({ signal }) => fetchStatement(scope, period, signal),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    networkMode: 'always',
    refetchOnWindowFocus: false,
  });
}

/** كشف شهر واحد للشاشة: الفشل بيتعرض ومعاه زرار «جرّب تاني» بدل حلقة طلبات. */
export function useCommissionStatement(scope: StatementScope, period: string) {
  return useQuery(statementQueryOptions(scope, period));
}

function httpStatusOf(error: unknown): unknown {
  return (error as { status?: unknown } | null)?.status;
}

/** القراءة اترفضت كأنها مش مسموحة أو مش موجودة: 403 بكود FORBIDDEN أو 404. */
export function isStatementDenied(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (httpStatusOf(error) === 403 && code === 'FORBIDDEN') || httpStatusOf(error) === 404;
}

/** أي 403 أو 404 على القراءة بيخفي الكشف المحفوظ في الكاش، حتى 403 FEATURE_DISABLED (برسالته هو). */
export function isStatementRefused(error: unknown): boolean {
  return httpStatusOf(error) === 403 || httpStatusOf(error) === 404;
}
