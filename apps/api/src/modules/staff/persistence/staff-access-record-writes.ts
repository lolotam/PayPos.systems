import type { IdGenerator, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { StaffAccessError } from '../domain/errors.ts';
import type { StaffAccessRole } from '../ports/staff-access-begin.port.ts';
import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import { insertExtraBranches } from './staff-access-extra-branches.ts';

/** مدخلات كتابة سجل الدخول: النشاط والموظفة والمعرّفات واللحظة. */
export interface StaffAccessRecordWriteInput {
  /** نشاط الموظفة. */
  readonly businessId: string;
  /** الموظفة. */
  readonly employeeId: string;
  /** مولّد المعرّفات. */
  readonly ids: IdGenerator;
  /** لحظة المعاملة. */
  readonly at: Date;
}

/**
 * يكتب إيميل الاستعادة ويزوّد المراجعة ويسجّل التدقيق؛ مخالفة الفهرس الفريد بتتحول لرفض مسمّى.
 *
 * @param tx         معاملة الشركة
 * @param companyId  الشركة
 * @param employeeId الموظفة
 * @param email      الإيميل المطبّع
 * @param audit      مسار التدقيق
 */
export async function writeRecoveryEmail(
  tx: Tx,
  companyId: string,
  employeeId: string,
  email: string,
  audit: AuditTrail,
): Promise<void> {
  const [current] = await tx.execute<{ recovery_email: string | null }>(
    sql`SELECT recovery_email FROM employees WHERE company_id=${companyId} AND id=${employeeId} AND deleted_at IS NULL`,
  );
  if (current === undefined || current.recovery_email === email) return;
  try {
    await tx.execute(
      sql`UPDATE employees SET recovery_email=${email},revision=revision+1 WHERE company_id=${companyId} AND id=${employeeId} AND deleted_at IS NULL`,
    );
  } catch (error) {
    const cause = error instanceof Error && 'cause' in error ? error.cause : error;
    if (
      typeof cause === 'object' &&
      cause !== null &&
      'constraint_name' in cause &&
      cause.constraint_name === 'employees_company_recovery_email_uidx'
    )
      throw new StaffAccessError('EMPLOYEE_RECOVERY_EMAIL_TAKEN');
    throw error;
  }
  await audit.record({
    entity: 'employee',
    entityId: employeeId,
    action: 'updated',
    before: { recovery_email: current.recovery_email === null ? null : 'SET' },
    after: { recovery_email: current.recovery_email === null ? 'SET' : 'CHANGED' },
  });
}

/**
 * ينشئ سجل الانتظار مع تدقيق الإنشاء، والفروع الإضافية بتكتب في نفس المعاملة (080-b).
 *
 * @param tx      معاملة الشركة
 * @param actor   الشركة والمانح
 * @param input   النشاط والموظفة والمعرّفات واللحظة
 * @param audit   مسار التدقيق
 * @param record  الدور والفرع وبصمة الهاتف والفروع الإضافية
 * @returns السجل الجديد
 */
export async function insertPendingRecord(
  tx: Tx,
  actor: { readonly companyId: string; readonly userId: string },
  input: StaffAccessRecordWriteInput,
  audit: AuditTrail,
  record: {
    roleCode: StaffAccessRole;
    branchId: string;
    phoneHash: string;
    extraBranches?: readonly { readonly branchId: string; readonly role: StaffAccessRole }[] | undefined;
  },
): Promise<{
  id: string;
  state: 'PENDING';
  roleCode: StaffAccessRole;
  branchId: string;
  operationId: string;
  userId: null;
  membershipId: null;
  attemptId: string;
  attemptStartedAt: Date;
  grantedBy: string;
  phoneHash: string;
}> {
  const keys = await insertAccessRow(tx, actor, input, audit, record);
  await insertExtraBranches(tx, {
    companyId: actor.companyId,
    actorUserId: actor.userId,
    businessId: input.businessId,
    employeeId: input.employeeId,
    recordId: keys.id,
    ids: input.ids,
    at: input.at,
  }, record.extraBranches ?? []);
  return {
    id: keys.id,
    state: 'PENDING',
    roleCode: record.roleCode,
    branchId: record.branchId,
    operationId: keys.operationId,
    userId: null,
    membershipId: null,
    attemptId: keys.attemptId,
    attemptStartedAt: input.at,
    grantedBy: actor.userId,
    phoneHash: record.phoneHash,
  };
}

/** صف السجل نفسه ومعرّفات المحاولة — بلا الفروع الإضافية. */
async function insertAccessRow(
  tx: Tx,
  actor: { readonly companyId: string; readonly userId: string },
  input: StaffAccessRecordWriteInput,
  audit: AuditTrail,
  record: { roleCode: StaffAccessRole; branchId: string; phoneHash: string },
): Promise<{ id: string; operationId: string; attemptId: string }> {
  const id = input.ids.newId();
  const operationId = input.ids.newId();
  const attemptId = input.ids.newId();
  await tx.execute(sql`INSERT INTO employee_staff_access
    (company_id,id,business_id,employee_id,operation_id,role_code,branch_id,state,granted_by,phone_hash,
      attempt_id,attempt_started_at)
    VALUES (${actor.companyId},${id},${input.businessId},${input.employeeId},${operationId},
      ${record.roleCode},${record.branchId},'PENDING',${actor.userId},${record.phoneHash},
      ${attemptId},${input.at.toISOString()}::timestamptz)`);
  await audit.record({
    entity: 'employee_staff_access',
    entityId: id,
    action: 'created',
    after: { employee_id: input.employeeId, role_code: record.roleCode, state: 'PENDING' },
  });
  return { id, operationId, attemptId };
}

/**
 * يحرر محاولة رُفضت بهاتف مملوك: يحذف سجلاً بلا مستخدم أو يعيد سجل إعادة المنح إلى STOPPED،
 * والفروع الإضافية بتتشال مع السجل وبتتدقيق قبله (080-b).
 *
 * @param tx     معاملة الشركة
 * @param actor  الشركة والمانح
 * @param input  النشاط والموظفة والمعرّفات واللحظة
 * @param audit  مسار التدقيق
 * @param target السجل والمحاولة
 * @returns true لو السجل اتحرر
 */
export async function releaseAttemptRow(
  tx: Tx,
  actor: { readonly companyId: string; readonly userId: string },
  input: StaffAccessRecordWriteInput,
  audit: AuditTrail,
  target: { recordId: string; attemptId: string },
): Promise<boolean> {
  const restored = await tx.execute(sql`UPDATE employee_staff_access
    SET state='STOPPED',updated_at=${input.at.toISOString()}::timestamptz
    WHERE company_id=${actor.companyId} AND id=${target.recordId} AND attempt_id=${target.attemptId}
      AND state='PENDING' AND user_id IS NOT NULL RETURNING id`);
  if (restored.length !== 0) {
    await audit.record({
      entity: 'employee_staff_access',
      entityId: target.recordId,
      action: 'regrant_cancelled',
      after: { employee_id: input.employeeId, reason: 'PHONE_TAKEN' },
    });
    return true;
  }
  // الحذف بيمسح الفروع الإضافية.Cascade، فبتتقفل وبتتدقيق قبل الحذف (080-b).
  const children = await tx.execute<{ id: string; branch_id: string; role_code: string }>(sql`
    SELECT id, branch_id, role_code FROM employee_staff_access_branches
    WHERE company_id=${actor.companyId} AND access_id=${target.recordId} ORDER BY id FOR UPDATE`);
  const removed = await tx.execute(sql`DELETE FROM employee_staff_access
    WHERE company_id=${actor.companyId} AND id=${target.recordId} AND attempt_id=${target.attemptId}
      AND state='PENDING' AND user_id IS NULL RETURNING id`);
  if (removed.length === 0) return false;
  for (const child of children)
    await audit.record({
      entity: 'employee_staff_access_branch',
      entityId: child.id,
      action: 'deleted',
      before: { branch_id: child.branch_id, role_code: child.role_code },
      after: { access_id: target.recordId, employee_id: input.employeeId, reason: 'PHONE_TAKEN' },
    });
  await audit.record({
    entity: 'employee_staff_access',
    entityId: target.recordId,
    action: 'deleted',
    after: { employee_id: input.employeeId, reason: 'PHONE_TAKEN' },
  });
  return true;
}
