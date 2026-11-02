import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** صف الموظفة في قائمة الخطط: المعرّف والاسمان والرقم الوظيفي بس، من غير أي بيانات موارد بشرية. */
export type CommissionPlanEmployeeNameRow = {
  readonly id: string;
  readonly name_ar: string | null;
  readonly name_en: string;
  readonly employee_number: number;
};

/**
 * جملة أسماء موظفي النشاط لقائمة شاشات الخطط (FR-010a): الاسم الإنجليزي والعربي والرقم
 * الوظيفي فقط، مرتبة بـ (name_en_key, id) عشان التكرار في الاسم ميكسرش الترتيب.
 * الاستعلام بالـ keyset مش بالـ offset: الشاشة بتقرأ صفحة ورا صفحة، والـ offset كان بيرجع
 * نفس الصف من أول الجدول مع كل صفحة.
 */
export function commissionPlanEmployeeNamesStatement(
  companyId: string,
  businessId: string,
  afterId: string | null,
  limit: number,
) {
  if (afterId === null) {
    return sql`SELECT e.id, e.name_ar, e.name_en, e.employee_number
      FROM employees e
      WHERE e.company_id = ${companyId} AND e.business_id = ${businessId} AND e.deleted_at IS NULL
      ORDER BY e.name_en_key, e.id
      LIMIT ${limit + 1}`;
  }
  // المرساة (anchor) مقروءة مرة واحدة بصف واحد، ومش بتفلتر deleted_at: لو الموظفة المرجعية
  // اتحذفت بين الصفحات، انتهاء القائمة بيكون غلط والصفحة الجاية لازم تكمّل من بعدها.
  // ولو المرساة مش موجودة (معرّف من نشاط تاني أو موظفة ما اتعملتش) الـ JOIN بيرجّع صفحة فاضية،
  // من غير ما يكشف إن المعرّف موجود أو لأ.
  return sql`SELECT e.id, e.name_ar, e.name_en, e.employee_number
    FROM employees e
    JOIN LATERAL (
      SELECT a.name_en_key, a.id FROM employees a
      WHERE a.company_id = ${companyId} AND a.business_id = ${businessId} AND a.id = ${afterId}
    ) anchor ON TRUE
    WHERE e.company_id = ${companyId} AND e.business_id = ${businessId} AND e.deleted_at IS NULL
      AND (e.name_en_key, e.id) > (anchor.name_en_key, anchor.id)
    ORDER BY e.name_en_key, e.id
    LIMIT ${limit + 1}`;
}

/**
 * يقرأ أسماء موظفي النشاط في صفحة واحدة على معاملة القارئ نفسها.
 * المسار بيقرأ الاسم والرقم الوظيفي بس: الفرع والدور والراتب والتليفون والوثائق وربط
 * المستخدم مش عليه، لأن المحاسب مالوش صلاحية الموظفين.
 */
export async function readCommissionPlanEmployeeNames(
  tx: Tx,
  companyId: string,
  businessId: string,
  afterId: string | null,
  limit: number,
): Promise<readonly CommissionPlanEmployeeNameRow[]> {
  return tx.execute<CommissionPlanEmployeeNameRow>(
    commissionPlanEmployeeNamesStatement(companyId, businessId, afterId, limit),
  );
}
