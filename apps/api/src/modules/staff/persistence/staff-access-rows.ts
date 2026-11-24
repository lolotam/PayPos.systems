import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { StaffAccessRecordRow } from '../domain/staff-access.ts';
import type { StaffAccessRole } from '../ports/staff-access-begin.port.ts';
import type { StaffAccessEmployeeRow } from '../ports/staff-access.port.ts';

/** SQL الموظفة المشترك بين مُقرئي «إعطاء الدخول» — مصدر واحد لإسقاط الأعمدة (P2-2). */
export const STAFF_ACCESS_EMPLOYEE_COLUMNS = sql`id, business_id, primary_branch_id, user_id,
  COALESCE(NULLIF(name_en, ''), name_ar, '') AS display_name`;

/** SQL سجل الدخول المشترك بكل أعمدته بما فيها hash الهاتف والمانح. */
export const STAFF_ACCESS_RECORD_COLUMNS = sql`id, state, role_code, branch_id, operation_id,
  user_id, membership_id, attempt_id, attempt_started_at, granted_by, phone_hash`;

/** صف الموظفة كما يعود من SQL المشترك. */
export type StaffAccessEmployeeSqlRow = {
  readonly id: string;
  readonly business_id: string;
  readonly primary_branch_id: string;
  readonly user_id: string | null;
  readonly display_name: string;
};

/** صف السجل كما يعود من SQL المشترك. */
export type StaffAccessRecordSqlRow = {
  readonly id: string;
  readonly state: StaffAccessRecordRow['state'];
  readonly role_code: StaffAccessRole;
  readonly branch_id: string;
  readonly operation_id: string;
  readonly user_id: string | null;
  readonly membership_id: string | null;
  readonly attempt_id: string;
  readonly attempt_started_at: Date;
  readonly granted_by: string;
  readonly phone_hash: string;
};

/** يوّلّد صف الموظفة للطبقات العليا من صف SQL. */
export function toEmployeeRow(row: StaffAccessEmployeeSqlRow): StaffAccessEmployeeRow {
  return {
    id: row.id,
    businessId: row.business_id,
    primaryBranchId: row.primary_branch_id,
    userId: row.user_id,
    displayName: row.display_name,
  };
}

/** يوّلّد صف السجل للطبقات العليا من صف SQL. */
export function toRecordRow(
  row: StaffAccessRecordSqlRow,
): StaffAccessRecordRow & { grantedBy: string; phoneHash: string } {
  return {
    id: row.id,
    state: row.state,
    roleCode: row.role_code,
    branchId: row.branch_id,
    operationId: row.operation_id,
    userId: row.user_id,
    membershipId: row.membership_id,
    attemptId: row.attempt_id,
    attemptStartedAt: new Date(row.attempt_started_at),
    grantedBy: row.granted_by,
    phoneHash: row.phone_hash,
  };
}

/** يقفل الشركة النشطة FOR NO KEY UPDATE — أول قفل في كل مسار كتابة (P1-3). */
export async function lockCompanyRow(tx: Tx, companyId: string): Promise<boolean> {
  const rows = await tx.execute(sql`SELECT id FROM companies
    WHERE id=${companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`);
  return rows.length === 1;
}

/** يقرأ سجل الدخول للموظفة بلا قفل إضافي. */
export async function readRecordRow(
  tx: Tx,
  companyId: string,
  employeeId: string,
): Promise<(StaffAccessRecordRow & { grantedBy: string; phoneHash: string }) | null> {
  const [row] = await tx.execute<StaffAccessRecordSqlRow>(sql`SELECT ${STAFF_ACCESS_RECORD_COLUMNS}
    FROM employee_staff_access
    WHERE company_id=${companyId} AND employee_id=${employeeId} FOR UPDATE`);
  return row === undefined ? null : toRecordRow(row);
}

/** يقفل صف الموظفة ويقرأ سجل الدخول معًا بترتيب الأقفال الموحد — employee ثم record (P1-3). */
export async function lockRecordWithEmployee(
  tx: Tx,
  companyId: string,
  input: { businessId: string; employeeId: string },
): Promise<{
  employee: StaffAccessEmployeeRow | null;
  record: (StaffAccessRecordRow & { grantedBy: string; phoneHash: string }) | null;
}> {
  const [employee] = await tx.execute<StaffAccessEmployeeSqlRow>(
    sql`SELECT ${STAFF_ACCESS_EMPLOYEE_COLUMNS} FROM employees
    WHERE company_id=${companyId} AND business_id=${input.businessId}
      AND id=${input.employeeId} AND deleted_at IS NULL FOR UPDATE`,
  );
  return {
    employee: employee === undefined ? null : toEmployeeRow(employee),
    record: await readRecordRow(tx, companyId, input.employeeId),
  };
}
