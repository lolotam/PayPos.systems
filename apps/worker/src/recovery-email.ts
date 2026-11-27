import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * قارئ إيميل استعادة الموظفة للعامل المحجوز: withTenant لشركتها على pospay_app، موظفة واحدة غير
 * محذوفة بصلاحية دخول سارية (أي عدد صفوف غير واحد = null). الإيميل بيتسلّم لذاكرة الإرسال بس،
 * وبصمته بتتقارن بصمة الاعتماد قبل ما يتبعت له أي كود (spec 079 PR-c1).
 *
 * @param database مغلفات الشركات
 * @returns دالة القراءة المربوطة في تنفيذ الاعتماد
 */
export function recoveryEmailReader(database: TenantWrappers) {
  return (companyId: string, userId: string): Promise<string | null> =>
    database.withTenant(companyId, async (tx) => {
      const rows = await tx.execute<{ recovery_email: string | null }>(sql`SELECT e.recovery_email
        FROM employees e
        JOIN employee_staff_access a ON a.company_id=e.company_id AND a.employee_id=e.id AND a.state='ACTIVE'
        WHERE e.company_id=${companyId} AND a.user_id=${userId}
          AND e.recovery_email IS NOT NULL AND e.deleted_at IS NULL
        LIMIT 2`);
      return rows.length === 1 ? (rows[0]?.recovery_email ?? null) : null;
    });
}
