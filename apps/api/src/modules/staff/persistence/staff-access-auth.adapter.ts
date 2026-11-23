import { StaffPhoneTakenError, type TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { Tx } from '@pospay/db';

import {
  cancelStaffUser,
  hashStaffPin,
  provisionStaffUser,
  readStaffAccessAuthority,
} from '../../identity/index.ts';
import type { StaffUserFacade } from '../../identity/index.ts';
import { StaffAccessError } from '../domain/errors.ts';
import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import type { StaffAccessRecordRow } from '../domain/staff-access.ts';
import type {
  CancelPendingScope,
  CancelPendingStaffAccessSteps,
  StaffAccessActor,
  StaffAccessEmployeeRow,
  StaffAccessUserSteps,
} from '../ports/staff-access.port.ts';

interface CancelInput {
  readonly businessId: string;
  readonly employeeId: string;
  readonly ids: { newId(): string };
  readonly at: Date;
}

/**
 * خطوة auth في «إعطاء الدخول»: الإنشاء أو الإيجاد بمعرّف العملية وتصوير الرقم السري عبر identity —
 * سهم staff → identity المعلن، وpackages/auth لا يراه staff أبداً (plan §2.1). رفض الهاتف المملوك
 * لغيره بيتترجم هنا لخطأ staff معروف بلا أي تفاصيل عن الحساب الآخر (FR-F1-5).
 *
 * @param auth واجهة packages/auth على pospay_auth
 * @returns الخطوة الثانية بإنشاء المستخدم وتصوير الرقم
 */
export function createStaffAccessUserSteps(auth: StaffUserFacade): StaffAccessUserSteps {
  return {
    provision: async (input) => {
      try {
        return await provisionStaffUser(auth, {
          operationId: input.operationId,
          companyId: input.companyId,
          phone: input.phone,
          name: input.name,
          actorUserId: input.actorUserId,
          ids: input.ids,
        });
      } catch (error) {
        if (error instanceof StaffPhoneTakenError)
          throw new StaffAccessError('STAFF_ACCESS_PHONE_TAKEN');
        throw error;
      }
    },
    hash: (pin) => hashStaffPin(pin),
  };
}

/**
 * إلغاء مستخدم الموظفة عبر identity — المسار الوحيد لحذف هذا الحساب (FR-F1-6)، ورفض identity
 * المتوقع بيتترجم لخطأ staff معروف قبل ما يوصل الـ use case.
 *
 * @param auth  واجهة packages/auth على pospay_auth
 * @param input معرّف العملية والشركة والمانح ومولّد المعرّفات
 */
export async function cancelStaffUserThroughIdentity(
  auth: StaffUserFacade,
  input: { operationId: string; companyId: string; actorUserId: string; ids: { newId(): string } },
): Promise<void> {
  return cancelStaffUser(auth, input);
}

function cancelScope(tx: Tx, actor: StaffAccessActor, input: CancelInput): CancelPendingScope {
  const audit = transactionWriters(tx, input.ids).audit;
  return {
    lock: () => lockRecordAndEmployee(tx, actor, input),
    authority: (businessId, branchId) =>
      readStaffAccessAuthority(tx, {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        businessId,
        branchId,
      }),
    deleteRecord: (recordId) => deletePendingRecord(tx, actor, input, audit, recordId),
  };
}

async function lockRecordAndEmployee(
  tx: Tx,
  actor: StaffAccessActor,
  input: CancelInput,
): Promise<{
  employee: StaffAccessEmployeeRow | null;
  record: StaffAccessRecordRow | null;
}> {
  const [employee] = await tx.execute<{
    id: string;
    business_id: string;
    primary_branch_id: string;
    user_id: string | null;
    display_name: string;
  }>(sql`SELECT id, business_id, primary_branch_id, user_id,
      COALESCE(NULLIF(name_en, ''), name_ar, '') AS display_name FROM employees
    WHERE company_id=${actor.companyId} AND business_id=${input.businessId}
      AND id=${input.employeeId} AND deleted_at IS NULL FOR UPDATE`);
  const [record] = await tx.execute<{
    id: string;
    state: StaffAccessRecordRow['state'];
    role_code: StaffAccessRecordRow['roleCode'];
    branch_id: string;
    operation_id: string;
    user_id: string | null;
    membership_id: string | null;
    created_at: Date;
  }>(sql`SELECT id, state, role_code, branch_id, operation_id, user_id, membership_id, created_at
    FROM employee_staff_access
    WHERE company_id=${actor.companyId} AND employee_id=${input.employeeId} FOR UPDATE`);
  return {
    employee:
      employee === undefined
        ? null
        : {
            id: employee.id,
            businessId: employee.business_id,
            primaryBranchId: employee.primary_branch_id,
            userId: employee.user_id,
            displayName: employee.display_name,
          },
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
            createdAt: new Date(record.created_at),
          },
  };
}

async function deletePendingRecord(
  tx: Tx,
  actor: StaffAccessActor,
  input: CancelInput,
  audit: AuditTrail,
  recordId: string,
): Promise<boolean> {
  const removed = await tx.execute(sql`DELETE FROM employee_staff_access
    WHERE company_id=${actor.companyId} AND id=${recordId} AND state='PENDING'`);
  if (removed.length === 0) return false;
  await audit.record({
    entity: 'employee_staff_access',
    entityId: recordId,
    action: 'deleted',
    after: { employee_id: input.employeeId, reason: 'PENDING_CANCELLED' },
  });
  return true;
}

/**
 * يفتح معاملة إلغاء سجل الانتظار على pospay_app.
 *
 * @param database مغلفات الشركة من @pospay/db
 * @returns المنفذ الذي يشغّل الإلغاء داخل معاملته
 */
export function createCancelPendingStaffAccessSteps(
  database: TenantWrappers,
): CancelPendingStaffAccessSteps {
  return {
    run: (actor, input, work) =>
      database.withTenant(actor.companyId, (tx) => work(cancelScope(tx, actor, input)), {
        userId: actor.userId,
      }),
  };
}
