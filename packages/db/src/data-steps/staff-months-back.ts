import { sql } from 'drizzle-orm';
import type postgres from 'postgres';

import type { Database } from '../client.ts';

/**
 * رفض ثابت النص لدور ترحيل بلا تجاوز للعزل: لا يحمل رابطاً ولا باسورد ولا بيانات.
 * بدون التجاوز، قراءة الشركات تحت FORCE RLS ترجع صفر صفوف، والخطوة كانت هتعدّي من غير ما تقصّر أي قيمة.
 */
export class StaffMonthsBackRoleRefusedError extends Error {
  readonly code = '42501';
  constructor() {
    super(
      'Migration data step staff-months-back needs a superuser or BYPASSRLS migration role; it would read no companies under FORCE RLS',
    );
  }
}

/**
 * بيقصّر عدد الشهور المحفوظ فوق 12 لـ 12 في كل شركة، قبل تضييق الـ CHECK.
 * القاعدة: القرار MY-Q9/D-A14 بيخلي المدى من 1 لـ 12، والصفوف اللي اتحفظت تحت المدى القديم لازم
 * تنزل لـ 12 الأول، وإلا تضييق الـ CHECK هيفشل. الخطوة idempotent: تشغيل تاني بيقصّر صفر صفوف.
 * الخطوة مبنية على ADR-0038 وبتعمل على الـ schema وقت ترحيلها (العمود موجود من migration 0161).
 *
 * @param owner اتصال الترحيل لاكتشاف معرفات الشركات فقط
 * @param app واجهة التطبيق المقيدة بعزل الشركات
 * @returns عدد الشركات وعدد الصفوف اللي اتقصّرت
 */
export async function clampStaffMonthsBack(
  owner: postgres.Sql,
  app: Database,
): Promise<{ companies: number; clamped: number }> {
  const [role] = await owner<{ bypass: boolean }[]>`
    SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
  if (role?.bypass !== true) throw new StaffMonthsBackRoleRefusedError();
  const companies = await owner<{ id: string }[]>`SELECT id FROM companies ORDER BY id`;
  let clamped = 0;
  for (const { id: companyId } of companies) {
    const rows = await app.withTenant(companyId, async (tx) =>
      tx.execute<{ business_id: string }>(sql`
        UPDATE business_settings SET staff_months_back = 12
        WHERE company_id = ${companyId} AND staff_months_back > 12
        RETURNING business_id`),
    );
    clamped += rows.length;
  }
  return { companies: companies.length, clamped };
}
