import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';

/** صف سجل دخول الموظفة كما تقرأه شاشة اللوحة — بلا هاتف كامل ولا بريد ولا أي hash. */
export interface StaffAccessStateRow {
  readonly branchId: string;
  readonly linkedUserId: string | null;
  readonly record:
    | null
    | {
        readonly id: string;
        readonly state: 'PENDING' | 'ACTIVE' | 'STOPPED' | 'PHONE_CHANGING' | 'CANCELLING';
        readonly roleCode: 'staff' | 'reception';
        readonly branchId: string;
        readonly operationId: string;
        readonly userId: string | null;
        readonly membershipId: string | null;
      };
}

/**
 * سلطة «إعطاء الدخول» على فرع الموظفة الأساسي (FR-F1-3): بتتقري جوه معاملة الكتابة بعد قفل صف
 * الموظفة، فتغيّر الصلاحية أثناء الانتظار ما يقدرش يعدي الفحص — نفس بروتوكول أقفال PR 7.
 *
 * @param tx    معاملة الشركة التي يفتحها المستدعِ
 * @param input الشركة والقارئ والنشاط والفرع الأساسي للموظفة
 * @returns true لو القارئ بيملك `manage:staff-access:branch` على الفرع ده
 */
export async function readStaffAccessAuthority(
  tx: Tx,
  input: { companyId: string; actorUserId: string; businessId: string; branchId: string },
): Promise<boolean> {
  const [company] = await tx.execute(
    sql`SELECT id FROM companies WHERE id=${input.companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`,
  );
  if (company === undefined) return false;
  await tx.execute(
    sql`SELECT id FROM memberships WHERE company_id=${input.companyId} AND user_id=${input.actorUserId} ORDER BY id FOR UPDATE`,
  );
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return false;
  const access = await readAccessTransaction(tx, input.companyId, input.actorUserId, new Date(time.at));
  return evaluateAccess(access.grants, 'manage:staff-access:branch', {
    companyId: input.companyId,
    businessId: input.businessId,
    branchId: input.branchId,
  });
}

/**
 * حالة دخول موظفة واحدة للقراءة (شاشة لوحة الموظفين): فرعها الأساسي ومستخدمها المرتبط وسجل الدخول
 * إن وُجد. الموظفة المحذوفة أو الغريبة بترجع null عشان المسار يرد EMPLOYEE_NOT_FOUND من غير كشف أي شيء.
 *
 * @param tx    معاملة قراءة داخل الشركة
 * @param input الشركة والنشاط والموظفة
 * @returns الفرع الأساسي والربط والسجل، أو null لموظفة غير موجودة
 */
export async function readStaffAccessState(
  tx: Tx,
  input: { companyId: string; businessId: string; employeeId: string },
): Promise<StaffAccessStateRow | null> {
  const [employee] = await tx.execute<{ primary_branch_id: string; user_id: string | null }>(sql`
    SELECT primary_branch_id, user_id FROM employees
    WHERE company_id=${input.companyId} AND business_id=${input.businessId}
      AND id=${input.employeeId} AND deleted_at IS NULL`);
  if (employee === undefined) return null;
  const [record] = await tx.execute<{
    id: string;
    state: 'PENDING' | 'ACTIVE' | 'STOPPED' | 'PHONE_CHANGING' | 'CANCELLING';
    role_code: 'staff' | 'reception';
    branch_id: string;
    operation_id: string;
    user_id: string | null;
    membership_id: string | null;
  }>(sql`
    SELECT id, state, role_code, branch_id, operation_id, user_id, membership_id
    FROM employee_staff_access
    WHERE company_id=${input.companyId} AND employee_id=${input.employeeId}`);
  return {
    branchId: employee.primary_branch_id,
    linkedUserId: employee.user_id,
    record:
      record === undefined
        ? null
        : {
            id: record.id,
            state: record.state,
            roleCode: record.role_code,
            branchId: record.branch_id,
            operationId: record.operation_id,
            userId: record.user_id,
            membershipId: record.membership_id,
          },
  };
}
