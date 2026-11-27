import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { PackageImportRecoveryTransactions } from '../ports/package-import-recovery.port.ts';

/**
 * الصفحة الكاملة بعبارة واحدة: المرشحون المؤهلون يُقفلون بالترتيب بـ LIMIT 50 وSKIP LOCKED ثم يُفشَل المشروط من بينهم فقط.
 * SKIP LOCKED يترك الصف الذي يحمله تثبيت جارٍ ليقرر المسح التالي بدل أن ينتظر خلف قفله ميزانية كاملة؛ والتحديث
 * الخارجي يعيد فحص الحالة فلا يفوز الطرفان معًا ولا يُنصف نصف أثر مالي.
 *
 * @param companyId هوية المستأجر
 * @param before الحد الشامل لوقت قبول الطلب من الساعة المحقونة
 * @returns عبارة التحديث الكاملة التي تعيد معرفات الصفوف المُفشلة
 */
export function packageImportRecoveryPage(companyId: string, before: Date) {
  return sql`WITH candidates AS MATERIALIZED (
    SELECT id FROM import_previews
    WHERE company_id=${companyId} AND entity='packages' AND status='commit_requested'
      AND requested_at<=${before.toISOString()}
    ORDER BY requested_at,id LIMIT 50 FOR UPDATE SKIP LOCKED)
  UPDATE import_previews p SET status='failed', error_code='IMPORT_COMMIT_FAILED'
  FROM candidates
  WHERE p.company_id=${companyId} AND p.id=candidates.id AND p.entity='packages'
    AND p.status='commit_requested'
  RETURNING p.id`;
}

export function packageImportRecoveryTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  options: { timeoutMs: number },
): PackageImportRecoveryTransactions {
  const withTenant = <T>(companyId: string, work: (tx: Tx) => Promise<T>) =>
    database.withTenant(companyId, work, options);
  return {
    hasPending: (companyId) =>
      withTenant(companyId, async (tx) => {
        const rows = await tx.execute(sql`
          SELECT 1 FROM import_previews
          WHERE company_id=${companyId} AND entity='packages' AND status='commit_requested' LIMIT 1`);
        return rows.length > 0;
      }),
    failStalePage: (companyId, before) =>
      withTenant(companyId, async (tx) => {
        const rows = await tx.execute<{ id: string }>(packageImportRecoveryPage(companyId, before));
        return rows.length;
      }),
  };
}
