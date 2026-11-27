import type { StaffRecoveryReader } from '@pospay/auth';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * قراءة ضيقة لإيميل الاستعادة تحت withTenant لشركة الجهاز (pospay_app). الشرط بيعيد ذكر
 * شرط الفهرس الجزئي عشان يخدم المطابقة، و LIMIT 2 عشان أي تكرار يفشل مغلقاً (spec 079 PR-c1، الشرط 1).
 *
 * @param database مغلفات الشركة
 * @returns قارئ يرجّع صاحب الحساب لو موظفة واحدة فقط بصلاحية دخول سارية
 */
export function createStaffRecoveryReader(database: TenantWrappers): StaffRecoveryReader {
  return {
    userByEmail: (device, email) =>
      database.withTenant(device.companyId, async (tx) => {
        const rows = await tx.execute<{ user_id: string | null }>(sql`SELECT a.user_id
          FROM employees e
          JOIN employee_staff_access a ON a.company_id=e.company_id AND a.employee_id=e.id AND a.state='ACTIVE'
          WHERE e.company_id=${device.companyId} AND lower(e.recovery_email)=lower(${email})
            AND e.recovery_email IS NOT NULL AND e.deleted_at IS NULL
          LIMIT 2`);
        return rows.length === 1 ? (rows[0]?.user_id ?? null) : null;
      }),
  };
}
