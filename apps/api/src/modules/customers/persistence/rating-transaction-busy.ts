// PostgreSQL: query_canceled — مهلة الـ statement أو مهلة انتظار القفل لغت الـ statement.
const PG_QUERY_CANCELED = '57014';

/**
 * القفل ما اتاخدش في الوقت: مهلة المعاملة خلصت، أو نتيجة الـ commit اتلغبطت، أو PostgreSQL لغى الـ statement.
 * دي الحالات التلاتة بس — أي خطأ تاني يعدّي زي ما هو عشان الفشل الحقيقي يفضل متميّز.
 *
 * @param error الخطأ اللي طلع من المعاملة
 * @returns `true` لو الخطأ معناه إن المعاملة مش جاهزة دلوقتي
 */
export function isRatingTransactionBusy(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { name?: unknown; code?: unknown; cause?: unknown };
    if (candidate.name === 'TimeoutError' || candidate.name === 'CommitOutcomeUnknownError')
      return true;
    if (candidate.code === PG_QUERY_CANCELED) return true;
    current = candidate.cause;
  }
  return false;
}
