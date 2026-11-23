import { sql } from 'drizzle-orm';

import type { IdGenerator, Tx } from '../src/index.ts';
import type { CommissionTenant } from './commission-statement-fixtures.ts';

/** قيم مرحّل جاهز للإدراج؛ الافتراضي رصيد عمولة سالب من أكتوبر لنوفمبر. */
export interface CarryValues {
  readonly businessId: string;
  readonly employeeId: string;
  readonly kind: string;
  readonly amount: string;
  readonly sourceStatementId: string;
  readonly sourcePeriod: string;
  readonly targetStatementId: string;
  readonly targetPeriod: string;
}

/**
 * بيدخّل صف مرحّل جديد بمعرّف من المولّد، والافتراضي صف سليم للموظفة والنشاط بتوع الشريحة؛
 * اختبارات الرفض بتغيّر عمود واحد بس.
 *
 * @param tx معاملة المستأجر الحالية
 * @param tenant الشريحة المالكة للصف
 * @param ids مولّد المعرفات
 * @param values كشفا المصدر والهدف، وأي عمود عايز يتبدّل
 * @returns معرّف الصف المُدخَل
 */
export async function insertCommissionCarry(
  tx: Tx,
  tenant: CommissionTenant,
  ids: IdGenerator,
  values: Pick<CarryValues, 'sourceStatementId' | 'targetStatementId'> & Partial<CarryValues>,
): Promise<string> {
  const row: CarryValues = {
    businessId: tenant.business,
    employeeId: tenant.employee,
    kind: 'COMMISSION',
    amount: '-25.000',
    sourcePeriod: '2026-10',
    targetPeriod: '2026-11',
    ...values,
  };
  const id = ids.newId();
  await tx.execute(sql`INSERT INTO commission_carries(
    company_id,id,business_id,employee_id,kind,amount,source_statement_id,source_period,
    target_period,target_statement_id)
    VALUES (${tenant.company},${id},${row.businessId},${row.employeeId},${row.kind},${row.amount},
      ${row.sourceStatementId},${row.sourcePeriod},${row.targetPeriod},${row.targetStatementId})`);
  return id;
}
