import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** صف الموظفة في قائمة الخطط، ومعاه مفتاح الترتيب الخام للمؤشر بس، من غير بيانات موارد بشرية. */
export type CommissionPlanEmployeeNameRow = {
  readonly id: string;
  readonly name_ar: string | null;
  readonly name_en: string;
  readonly employee_number: number;
  readonly name_en_key: string;
};

/**
 * جملة أسماء موظفي النشاط لقائمة شاشات الخطط (FR-010a)، مرتبة بالمفتاح المخزّن (name_en_key, id).
 * موضع البداية بييجي بالقيمة من المؤشر، فمفيش قراءة لصف مرساة ولا فرق بين محذوف وغير موجود.
 * name_en_key راجعة بس عشان المؤشر الجاي يحملها خام كما خزنها SQL، مش عشان تظهر في الرد.
 */
export function commissionPlanEmployeeNamesStatement(
  companyId: string,
  businessId: string,
  after: { readonly key: string; readonly id: string } | null,
  limit: number,
) {
  const afterPosition =
    after === null ? sql.empty() : sql`AND (e.name_en_key, e.id) > (${after.key}, ${after.id})`;
  return sql`SELECT e.id, e.name_ar, e.name_en, e.employee_number, e.name_en_key
    FROM employees e
    WHERE e.company_id = ${companyId} AND e.business_id = ${businessId} AND e.deleted_at IS NULL
      ${afterPosition}
    ORDER BY e.name_en_key, e.id
    LIMIT ${limit + 1}`;
}

/**
 * يقرأ أسماء موظفي النشاط في صفحة واحدة على معاملة القارئ نفسها.
 * مفتاح الترتيب بينتقل خام للمؤشر فقط؛ الفرع والدور والراتب والتليفون والوثائق وربط المستخدم
 * مش عليه، لأن المحاسب مالوش صلاحية الموظفين.
 */
export async function readCommissionPlanEmployeeNames(
  tx: Tx,
  companyId: string,
  businessId: string,
  after: { readonly key: string; readonly id: string } | null,
  limit: number,
): Promise<readonly CommissionPlanEmployeeNameRow[]> {
  return tx.execute<CommissionPlanEmployeeNameRow>(
    commissionPlanEmployeeNamesStatement(companyId, businessId, after, limit),
  );
}
