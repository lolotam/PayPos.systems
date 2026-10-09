import { employeeIbanView } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export const EMPLOYEE_IBAN_ACCESS = Symbol('EMPLOYEE_IBAN_ACCESS');
/** قراءة الإذن الحي دون استيراد طبقات الكتابة. */
export interface EmployeeIbanReadAccess {
  /** يعيد مستوى القراءة وإذن الإدارة عند الفروع المحفوظة. */
  check(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
    branchIds: readonly string[],
  ): Promise<{ read: boolean; manage: boolean; masked: boolean; featureEnabled: boolean }>;
}
export interface EmployeeIbanReadContext {
  companyId: string;
  userId: string;
  businessId: string;
  employeeId: string;
}

export async function employeeIbanDecision(
  tx: Tx,
  context: EmployeeIbanReadContext,
  access: EmployeeIbanReadAccess,
) {
  const { companyId, businessId, employeeId, userId } = context;
  // قسم الحساب وتاريخه يقيّمان الإذن عند الفروع المحفوظة قبل قراءة أي قيمة مصرفية.
  const [employee] = await tx.execute<{ branch_ids: string[] }>(sql`SELECT
    ARRAY(SELECT eb.branch_id FROM employee_branches eb WHERE eb.company_id=e.company_id AND eb.employee_id=e.id AND eb."to" IS NULL) || ARRAY[e.primary_branch_id] AS branch_ids
    FROM employees e WHERE e.company_id=${companyId} AND e.business_id=${businessId} AND e.id=${employeeId} AND e.deleted_at IS NULL`);
  return employee ? access.check(tx, companyId, userId, businessId, employee.branch_ids) : null;
}

export function employeeIbanStatement(context: EmployeeIbanReadContext, full: boolean) {
  // قارئ القسم المحدود لا يجلب الحساب أو البنك أو الاسم أو الممثل إلى ذاكرة التطبيق.
  return sql`SELECT revision, right(iban,4) AS iban_last4,
    to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS set_at
    ${full ? sql`, iban, bank_id, holder_name_en, set_by` : sql``}
    FROM employee_ibans WHERE company_id=${context.companyId} AND employee_id=${context.employeeId}
    ORDER BY revision DESC LIMIT 1`;
}

export async function employeeIban(
  tx: Tx,
  context: EmployeeIbanReadContext,
  access: EmployeeIbanReadAccess,
) {
  const decision = await employeeIbanDecision(tx, context, access);
  if (!decision || (!decision.read && !decision.masked)) return null;
  if (!decision.featureEnabled) return 'FEATURE_DISABLED' as const;
  const [row] = await tx.execute(employeeIbanStatement(context, decision.read));
  return employeeIbanView.parse({
    status: row?.['iban_last4'] ? 'SET' : 'NOT_SET',
    iban_last4: row?.['iban_last4'] ?? null,
    iban: row?.['iban'] ?? null,
    bank_id: row?.['bank_id'] ?? null,
    holder_name_en: row?.['holder_name_en'] ?? null,
    revision: row?.['revision'] ?? 0,
    set_at: row?.['set_at'] ?? null,
    set_by: row?.['set_by'] ?? null,
    can_read_full: decision.read,
    can_manage: decision.manage,
  });
}
