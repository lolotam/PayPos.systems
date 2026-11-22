import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** موظفة النشاط بأسمائها، وهي اللي بيعرضها التقدير (FR-023). */
export interface CommissionEstimateEmployeeRow {
  readonly employeeId: string;
  readonly nameAr: string | null;
  readonly nameEn: string;
  readonly employeeNumber: number;
}

/** ارتباط موظفة بفرع بتاريخين: البداية داخلة والنهاية خارجة، والفارغة ارتباط مفتوح. */
export interface CommissionBranchAttachmentRow {
  readonly employeeId: string;
  readonly branchId: string;
  readonly from: string;
  readonly to: string | null;
}

/**
 * يقرأ موظفات النشاط بأسمائهن وأرقامهن الوظيفية، للموظفات اللي اتشالوا من النشاط
 * كمان، لأن التقدير بيعرض موظفات استلمن تصحيح أو تقدير سابق (CM-23c).
 *
 * @param tx معاملة القراءة الحالية
 * @param companyId الشركة المؤكدة
 * @param businessId النشاط المطلوب
 * @param employeeId موظفة واحدة اختيارية؛ من غيرها كل موظفات النشاط
 * @returns موظفات النشاط مرتبة بالهوية
 */
export async function readCommissionEstimateEmployees(
  tx: Tx,
  companyId: string,
  businessId: string,
  employeeId: string | null,
): Promise<readonly CommissionEstimateEmployeeRow[]> {
  const rows = await tx.execute<{
    employeeId: string;
    nameAr: string | null;
    nameEn: string;
    employeeNumber: number;
  }>(sql`SELECT id AS "employeeId", name_ar AS "nameAr", name_en AS "nameEn",
      employee_number AS "employeeNumber"
    FROM employees
    WHERE company_id=${companyId} AND business_id=${businessId}
      ${employeeId === null ? sql`` : sql`AND id = ${employeeId}::uuid`}
    ORDER BY id`);
  return rows.map((row) => ({
    employeeId: row.employeeId,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    employeeNumber: row.employeeNumber,
  }));
}

/**
 * يقرأ ارتباطات الموظفات بالفروع بتاريخها الحيّة، وهي مفتاح الفلترة باليوم في
 * نطاق الفروع (CS-Q20 = PP-20.1). المدّة `[from, to)` زي مدّة جدول
 * `employee_branches` نفسها، والنهاية الفارغة ارتباط مفتوح للمستقبل.
 *
 * @param tx معاملة القراءة الحالية
 * @param companyId الشركة المؤكدة
 * @param businessId النشاط المطلوب
 * @param employeeIds الموظفات المطلوب ارتباطاتهن
 * @param period الشهر المطلوب بصيغة YYYY-MM
 * @returns الارتباطات التي تغطي الشهر، مرتبة بالموظفة ثم الفرع ثم البداية
 */
export async function readCommissionBranchAttachments(
  tx: Tx,
  companyId: string,
  businessId: string,
  employeeIds: readonly string[],
  period: string,
): Promise<readonly CommissionBranchAttachmentRow[]> {
  if (employeeIds.length === 0) return [];
  const ids = [...new Set(employeeIds)].sort();
  const rows = await tx.execute<{
    employeeId: string;
    branchId: string;
    from: string;
    to: string | null;
  }>(sql`SELECT employee_id AS "employeeId", branch_id AS "branchId",
      "from"::text AS "from", "to"::text AS "to"
    FROM employee_branches
    WHERE company_id=${companyId} AND business_id=${businessId}
      AND employee_id = ANY(ARRAY[${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}]::uuid[])
      AND "from" <= (${period} || '-01')::date + interval '1 month - 1 day'
      AND ("to" IS NULL OR "to" > (${period} || '-01')::date)
    ORDER BY employee_id, branch_id, "from"`);
  return rows.map((row) => ({
    employeeId: row.employeeId,
    branchId: row.branchId,
    from: row.from,
    to: row.to,
  }));
}
