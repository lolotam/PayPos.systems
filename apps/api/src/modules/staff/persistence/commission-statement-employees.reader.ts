import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** موظفة النشاط ببطاقتها وهل شغلها بيتقاطع مع الشهر؛ الباني بيجمّد البطاقة مع كل صف (D-20). */
export interface CommissionStatementEmployeeRow {
  readonly employeeId: string;
  readonly nameAr: string | null;
  readonly nameEn: string;
  readonly employeeNumber: number;
  /** مدة عملها (التعيين حتى نهاية العقد أو الحذف) بتغطي يوم من الشهر على الأقل (FR-033). */
  readonly employedDuringPeriod: boolean;
}

/**
 * موظفات النشاط كلهن بصف EMPLOYEE محتمل، من غير ما نفلتر المحذوفات لأن موظفة اتشالت لسه ممكن يكون
 * ليها تصحيح أو مرحّل في الشهر. `employedDuringPeriod` هي قاعدة «في النطاق» (FR-033): تعيينها قبل آخر
 * يوم في الشهر، ونهاية عقدها وحذفها لو موجودين مش قبل أول يوم فيه؛ والباقي بيدخل لو ليه أي مصدر.
 *
 * @param tx معاملة القراءة الحالية
 * @param companyId الشركة المؤكدة
 * @param businessId النشاط المطلوب
 * @param period الشهر بصيغة YYYY-MM
 * @returns الموظفات مرتبات بالمعرّف
 */
export async function readCommissionStatementEmployees(
  tx: Tx,
  companyId: string,
  businessId: string,
  period: string,
): Promise<readonly CommissionStatementEmployeeRow[]> {
  const rows = await tx.execute<{
    employeeId: string;
    nameAr: string | null;
    nameEn: string;
    employeeNumber: number;
    employed: boolean;
  }>(sql`SELECT id AS "employeeId", name_ar AS "nameAr", name_en AS "nameEn",
      employee_number AS "employeeNumber",
      (hire_date <= (date_trunc('month', (${period} || '-01')::date) + interval '1 month - 1 day')::date
        AND (contract_end IS NULL OR contract_end >= (${period} || '-01')::date)
        AND (deleted_at IS NULL OR deleted_at::date >= (${period} || '-01')::date)) AS "employed"
    FROM employees
    WHERE company_id=${companyId} AND business_id=${businessId}
    ORDER BY id`);
  return rows.map((row) => ({
    employeeId: row.employeeId,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    employeeNumber: row.employeeNumber,
    employedDuringPeriod: row.employed,
  }));
}
