import type postgres from 'postgres';

/**
 * يشغّل تنظيف جلسة المالك في معاملة بوضع `session_replication_role = replica` فقط، فلا تعترض تريغرات
 * الرفض (outbox المحسوب، جدولا إثبات تغطية العمولات) ولا تُشغَّل تريغرات المفاتيح الأجنبية على هذه المعاملة.
 * للاختبارات وحدها: لا يملك دور التطبيق ولا المرسِل هذا الوضع (ADR-0054 إضافة 2026-11-22 §5).
 *
 * @param owner اتصال مالك الـ migration (superuser الـ bootstrap)
 * @param work  خطوات التنظيف على معاملة الوضع المخفّف
 * @returns نتيجة `work`
 */
export function asReplicaOwner<T>(
  owner: postgres.Sql,
  work: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return owner.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    return work(tx);
  }) as Promise<T>;
}
