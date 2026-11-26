import { sql } from 'drizzle-orm';
import type postgres from 'postgres';

import type { DataStepApp } from './coverage.ts';
import type { Tx } from '../with-tenant.ts';

/**
 * أقصى مدة مقبولة لـ«كم شهر لورا»: 12 شهر (D-A14)، وهي نفس الحد اللي الدومين بيقصّر عليه القراءة.
 */
const MAX_STAFF_MONTHS_BACK = 12;

/**
 * رفض ثابت النص لدور ترحيل بلا تجاوز للعزل: لا يحمل رابطاً ولا باسورد ولا بيانات، فيمر من التعقيم كما هو.
 * بدون التجاوز، قراءة الشركات تحت FORCE RLS ترجع صفر صفوف، والخطوة كانت هتعدّي من غير ما تضيّق أي صف.
 */
export class StaffMonthsBackRoleRefusedError extends Error {
  readonly code = '42501';
  constructor() {
    super(
      'Migration data step staff-months-back needs a superuser or BYPASSRLS migration role; it would read no companies under FORCE RLS',
    );
  }
}

/** عدّادات خطوة تضييق مدى «كم شهر لورا» بلا أي أسماء أو معرّفات: الشركات والصفوف المقروءة والصفوف اللي اتغيّرت. */
export interface StaffMonthsBackResult {
  /** عدد الشركات اللي اتقريت معرفاتها من اتصال المالك. */
  readonly companies: number;
  /** عدد صفوف إعدادات النشاط اللي اتقريت جوه معاملات الشركات. */
  readonly read: number;
  /** عدد الصفوف اللي اتقصّرت قيمتها من فوق 12 على 12. */
  readonly clamped: number;
}

/**
 * يضيق مدى «كم شهر لورا» في القاعدة على 1..12 (issue #519): أي صف محفوظ فوق 12 (تحت المدى القديم 1..24)
 * بيتقصّر على 12، وباقي أعمدة الصف ما بتتلمسش. الخطوة مبنية على ADR-0038: المالك بيقرأ معرفات الشركات
 * بس، وكل قراءة وكتابة tenant بتجري جوه withTenant على pospay_app، فمفيش كتابة صف tenant من اتصال المالك.
 * الصفوف اللي قيمتها 1..12 أو null ما بتتغيرش، فإعادة التشغيل ما بتلاقي حاجة تضيّقها تاني.
 *
 * @param owner اتصال الترحيل لاكتشاف معرفات الشركات فقط
 * @param app واجهة التطبيق المقيدة بعزل الشركات
 * @returns أعداد الشركات والصفوف المقروءة والمقصّرة دون أسماء
 */
export async function clampStaffMonthsBack(
  owner: postgres.Sql,
  app: DataStepApp,
): Promise<StaffMonthsBackResult> {
  const [role] = await owner<{ bypass: boolean }[]>`
    SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
  if (role?.bypass !== true) throw new StaffMonthsBackRoleRefusedError();
  const companies = await owner<{ id: string }[]>`SELECT id FROM companies ORDER BY id`;
  const counts = { companies: companies.length, read: 0, clamped: 0 };
  for (const { id: companyId } of companies) {
    const result = await app.withTenant(companyId, (tx) => clampOneCompany(tx, companyId));
    counts.read += result.read;
    counts.clamped += result.clamped;
  }
  return counts;
}

/**
 * معاملة شركة واحدة: بتقيس صفوف إعدادات النشاط وبتقصّر القيم اللي فوق 12 من غير ما تلمس أي عمود تاني.
 * القيد الجديد (NOT VALID) بيمنع أي كتابة جديدة فوق 12 من لحظة ما اتضاف، فالصفوف القديمة بس هي
 * اللي بتفضل محتاجة تضييق.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة الجارية
 * @returns المقروء والمقصّر
 */
async function clampOneCompany(
  tx: Tx,
  companyId: string,
): Promise<{ read: number; clamped: number }> {
  const [counted] = await tx.execute<{ total: number }>(sql`
    SELECT count(*)::int AS total FROM business_settings WHERE company_id = ${companyId}`);
  const clamped = await tx.execute<{ business_id: string }>(sql`
    UPDATE business_settings SET staff_months_back = ${MAX_STAFF_MONTHS_BACK}
    WHERE company_id = ${companyId} AND staff_months_back > ${MAX_STAFF_MONTHS_BACK}
    RETURNING business_id`);
  return { read: counted?.total ?? 0, clamped: clamped.length };
}
