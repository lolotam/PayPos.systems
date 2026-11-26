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
  /** آخر يوم في العقد YYYY-MM-DD أو null؛ خام، والمجال هو اللي بيقرر «سابت الشغل» (CM-50). */
  readonly contractEnd: string | null;
  /** يوم الحذف بتوقيت النشاط YYYY-MM-DD أو null؛ خام زي `contractEnd`. */
  readonly deletedOn: string | null;
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
    contractEnd: string | null;
    deletedOn: string | null;
  }>(sql`SELECT e.id AS "employeeId", e.name_ar AS "nameAr", e.name_en AS "nameEn",
      e.employee_number AS "employeeNumber",
      (e.hire_date <= (date_trunc('month', (${period} || '-01')::date) + interval '1 month - 1 day')::date
        AND (e.contract_end IS NULL OR e.contract_end >= (${period} || '-01')::date)
        AND (e.deleted_at IS NULL OR e.deleted_at::date >= (${period} || '-01')::date)) AS "employed",
      e.contract_end::text AS "contractEnd",
      (e.deleted_at AT TIME ZONE b.timezone)::date::text AS "deletedOn"
    FROM employees e JOIN businesses b ON b.company_id = e.company_id AND b.id = e.business_id
    WHERE e.company_id=${companyId} AND e.business_id=${businessId}
    ORDER BY e.id`);
  return rows.map((row) => ({
    employeeId: row.employeeId,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    employeeNumber: row.employeeNumber,
    employedDuringPeriod: row.employed,
    contractEnd: row.contractEnd,
    deletedOn: row.deletedOn,
  }));
}
