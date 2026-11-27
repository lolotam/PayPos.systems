import type { AuthFacadeForStaffAccess } from '../ports/staff-access-auth.port.ts';
import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import type { Redis } from 'ioredis';
import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';

import {
  applyStaffAccessOverrides,
  createGrantInvalidator,
  grantStaffMembership,
  readStaffAccessAuthority,
  saveTemporaryStaffPin,
  staffAccessGrantedEvent,
  type StaffAccessGranted,
} from '../../identity/index.ts';
import { employeeWorkplace } from '../../tenancy/index.ts';
import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import type { OutboxWriter } from '../../../shared/ports/outbox-writer.port.ts';
import { StaffAccessError } from '../domain/errors.ts';
import type { StaffAccessRecordRow } from '../domain/staff-access.ts';
import type { StaffAccessRole } from '../ports/staff-access-begin.port.ts';
import type {
  GrantBeginScope,
  GrantCommitScope,
  GrantEmployeeAccessSteps,
  StaffAccessActor,
  StaffAccessEmployeeRow,
  StaffAccessGrantCache,
} from '../ports/staff-access.port.ts';
import {
  grantExtraBranchMemberships,
  readExtraBranches,
  replaceExtraBranches,
} from './staff-access-extra-branches.ts';
import {
  insertPendingRecord,
  releaseAttemptRow,
  writeRecoveryEmail,
  type StaffAccessRecordWriteInput,
} from './staff-access-record-writes.ts';
import {
  lockCompanyRow,
  lockExtraBranchRows,
  lockRecordWithEmployee,
  readRecordRow,
  STAFF_ACCESS_EMPLOYEE_COLUMNS,
  toEmployeeRow,
  type StaffAccessEmployeeSqlRow,
} from './staff-access-rows.ts';

interface CommitInput extends StaffAccessRecordWriteInput {
  readonly recordId: string;
}

/**
 * فحص السلطة على فرع: لازم الفرع يكون تابع للنشاط فعلاً (080-b) — فرع غريب أو مش موجود
 * بيرفض زيف بدل ما يبقى خطأ قيد أجنبي. بعدها صلاحية `manage:staff-access:branch` جوه
 * نفس المعاملة.
 */
function authorityChecker(tx: Tx, actor: StaffAccessActor): GrantBeginScope['authority'] {
  return async (businessId, branchId) => {
    const workplace = await employeeWorkplace(tx, actor.companyId, businessId, branchId);
    if (!workplace.businessExists || workplace.branchBusinessId !== businessId) return false;
    return readStaffAccessAuthority(tx, {
      companyId: actor.companyId,
      actorUserId: actor.userId,
      businessId,
      branchId,
    });
  };
}

function beginScope(
  tx: Tx,
  actor: StaffAccessActor,
  input: StaffAccessRecordWriteInput,
  phoneHashSecret: Buffer | string,
): GrantBeginScope {
  const audit = transactionWriters(tx, input.ids).audit;
  return {
    lockCompany: () => lockCompanyRow(tx, actor.companyId),
    lockEmployee: async () => {
      const [row] = await tx.execute<StaffAccessEmployeeSqlRow>(
        sql`SELECT ${STAFF_ACCESS_EMPLOYEE_COLUMNS} FROM employees
        WHERE company_id=${actor.companyId} AND business_id=${input.businessId}
          AND id=${input.employeeId} AND deleted_at IS NULL FOR UPDATE`,
      );
      return row === undefined ? null : toEmployeeRow(row);
    },
    authority: authorityChecker(tx, actor),
    findRecord: () => readRecordRow(tx, actor.companyId, input.employeeId),
    findExtraBranches: (recordId) => readExtraBranches(tx, actor.companyId, recordId),
    setRecoveryEmail: (email) =>
      writeRecoveryEmail(tx, actor.companyId, input.employeeId, email, audit),
    releaseAttempt: (recordId, attemptId) =>
      releaseAttemptRow(tx, actor, input, audit, { recordId, attemptId }),
    restartRecord: async (recordId, binding) => {
      await tx.execute(sql`UPDATE employee_staff_access SET state='PENDING',phone_hash=${binding.phoneHash},
        role_code=${binding.roleCode},branch_id=${binding.branchId},granted_by=${actor.userId},
        attempt_id=${input.ids.newId()},attempt_started_at=${input.at.toISOString()}::timestamptz,
        updated_at=${input.at.toISOString()}::timestamptz WHERE company_id=${actor.companyId} AND id=${recordId}`);
      // الفروع الإضافية القديمة بتتشال وبتتدقيق والجديدة بتكتب في نفس المعاملة (080-b).
      await replaceExtraBranches(
        tx,
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          businessId: input.businessId,
          employeeId: input.employeeId,
          recordId,
          ids: input.ids,
          at: input.at,
        },
        binding.extraBranches ?? [],
      );
      const record = await readRecordRow(tx, actor.companyId, input.employeeId);
      if (record === null) throw new Error('STAFF_RECORD_RESTART_FAILED');
      return record;
    },
    // بصمة الهاتف مفتاحية: HMAC بمفتاح الجذر مع فاصل نطاق، فالهاتف ما بيرجعش من البصمة.
    phoneHash: (phone) =>
      createHmac('sha256', phoneHashSecret)
        .update('pospay:staff-access:phone:v1\0')
        .update(phone)
        .digest('hex'),
    insertRecord: (record) => insertPendingRecord(tx, actor, input, audit, record),
  };
}

function commitScope(
  tx: Tx,
  actor: StaffAccessActor,
  input: CommitInput,
  auth: AuthFacadeForStaffAccess,
): GrantCommitScope {
  const writers = transactionWriters(tx, input.ids);
  return {
    lockCompany: () => lockCompanyRow(tx, actor.companyId),
    recheck: () => recheckUnderLock(tx, actor, input),
    authority: authorityChecker(tx, actor),
    grantMembership: (membership) =>
      grantMembershipAndAudit(tx, auth, actor, input.ids, writers.audit, membership),
    grantExtraMemberships: (payload) =>
      grantExtraBranchMemberships(
        tx,
        auth,
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          businessId: payload.businessId,
          employeeId: payload.employeeId,
          recordId: payload.recordId,
          ids: input.ids,
          at: input.at,
        },
        {
          operationId: payload.operationId,
          userId: payload.userId,
          branches: payload.branches,
        },
      ),
    applyOverrides: (payload) =>
      applyStaffAccessOverrides(tx, input.ids, {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        memberships: payload.memberships,
        overrides: payload.overrides,
      }).catch((error: unknown) => {
        // رفض الاستثناء بيرجع كـ 403 واحد؛ أي خطأ تاني بيفضل زي ما هو (500 حقيقي).
        if (error instanceof Error && 'code' in error && error.code === 'STAFF_ACCESS_OVERRIDE_REFUSED')
          throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
        throw error;
      }),
    linkEmployee: (userId) => linkEmployeeAndAudit(tx, actor, input, writers.audit, userId),
    saveTemporaryPin: (userId, pinHash) =>
      saveTemporaryPinAndAudit(tx, actor, input, writers.audit, userId, pinHash),
    markActive: (mark) =>
      tx
        .execute(
          sql`UPDATE employee_staff_access
        SET state='ACTIVE',user_id=${mark.userId},membership_id=${mark.membershipId},updated_at=${input.at.toISOString()}::timestamptz
        WHERE company_id=${actor.companyId} AND id=${mark.recordId}`,
        )
        .then(() => undefined),
    appendEvent: (payload) =>
      appendGrantedEvent(writers.outbox, payload, { actorUserId: actor.userId, at: input.at }),
  };
}

/** إعادة الفحص تحت القفل: السجل والموظفة والفروع الإضافية مقفولة جوّه نفس المعاملة (080-b). */
async function recheckUnderLock(
  tx: Tx,
  actor: StaffAccessActor,
  input: CommitInput,
): Promise<{
  employee: StaffAccessEmployeeRow | null;
  record: StaffAccessRecordRow | null;
  extraBranches: readonly { id: string; branchId: string; roleCode: StaffAccessRole }[];
}> {
  const locked = await lockRecordWithEmployee(tx, actor.companyId, input);
  const extras = await lockExtraBranchRows(tx, actor.companyId, input.recordId);
  return {
    employee: locked.employee,
    record: locked.record,
    extraBranches: extras.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      roleCode: row.role_code,
    })),
  };
}

async function grantMembershipAndAudit(
  tx: Tx,
  auth: AuthFacadeForStaffAccess,
  actor: StaffAccessActor,
  ids: IdGenerator,
  audit: AuditTrail,
  membership: { operationId: string; userId: string; branchId: string; role: StaffAccessRole },
): Promise<{ membershipId: string }> {
  const granted = await grantStaffMembership(tx, auth, {
    operationId: membership.operationId,
    companyId: actor.companyId,
    userId: membership.userId,
    branchId: membership.branchId,
    role: membership.role,
    ids,
  });
  await audit.record({
    entity: 'membership',
    entityId: granted.membershipId,
    action: 'created',
    after: {
      user_id: membership.userId,
      scope_type: 'BRANCH',
      scope_id: membership.branchId,
      role: membership.role,
    },
  });
  return granted;
}

async function linkEmployeeAndAudit(
  tx: Tx,
  actor: StaffAccessActor,
  input: StaffAccessRecordWriteInput,
  audit: AuditTrail,
  userId: string,
): Promise<void> {
  await tx.execute(sql`UPDATE employees SET user_id=${userId},revision=revision+1
    WHERE company_id=${actor.companyId} AND business_id=${input.businessId}
      AND id=${input.employeeId} AND deleted_at IS NULL`);
  await audit.record({
    entity: 'employee',
    entityId: input.employeeId,
    action: 'updated',
    after: { user_id: userId },
  });
}

async function saveTemporaryPinAndAudit(
  tx: Tx,
  actor: StaffAccessActor,
  input: StaffAccessRecordWriteInput,
  audit: AuditTrail,
  userId: string,
  pinHash: string,
): Promise<void> {
  await saveTemporaryStaffPin(tx, {
    companyId: actor.companyId,
    userId,
    pinHash,
    setBy: actor.userId,
    at: input.at,
    ids: input.ids,
  });
  await audit.record({
    entity: 'cashier_pin',
    entityId: userId,
    action: 'staff.pin_set_temporary',
    after: { set_by: actor.userId, temporary: true },
  });
}

async function appendGrantedEvent(
  outbox: OutboxWriter,
  payload: {
    employeeId: string;
    userId: string;
    membershipId: string;
    branchId: string;
    role: StaffAccessRole;
  },
  stamp: { actorUserId: string; at: Date },
): Promise<void> {
  const event: StaffAccessGranted = {
    employee_id: payload.employeeId,
    user_id: payload.userId,
    membership_id: payload.membershipId,
    branch_id: payload.branchId,
    role: payload.role,
    actor_user_id: stamp.actorUserId,
    occurred_at: stamp.at.toISOString(),
  };
  const built = staffAccessGrantedEvent(event);
  await outbox.append({
    aggregateType: built.aggregateType,
    aggregateId: payload.employeeId,
    eventType: built.eventType,
    payload: built.payload,
  });
}

/**
 * يفتح معاملتي «إعطاء الدخول» على pospay_app: الخطوة الأولى تنشئ سجل الانتظار، والثالثة تُنجز
 * العضوية والربط والرقم المؤقت والحدث في التراجع الواحد (plan §4.2).
 *
 * @param database        مغلفات الشركة من @pospay/db
 * @param auth            واجهة حساب الموظفة عبر identity
 * @param phoneHashSecret مفتاح بصمة الهاتف (HMAC) — فاضي يرفع خطأ عند البناء بدل بصمة ضعيفة
 * @returns المنفذ الذي يشغّل شغل كل خطوة داخل معاملتها
 */
export function createGrantEmployeeAccessSteps(
  database: TenantWrappers,
  auth: AuthFacadeForStaffAccess,
  phoneHashSecret: Buffer | string,
): GrantEmployeeAccessSteps {
  if (phoneHashSecret.length === 0) throw new Error('STAFF_ACCESS_PHONE_HASH_SECRET_EMPTY');
  return {
    begin: (actor, input, work) =>
      database.withTenant(
        actor.companyId,
        (tx) => work(beginScope(tx, actor, input, phoneHashSecret)),
        {
          userId: actor.userId,
        },
      ),
    commit: (actor, input, work) =>
      database.withTenant(actor.companyId, (tx) => work(commitScope(tx, actor, input, auth)), {
        userId: actor.userId,
      }),
  };
}

/**
 * إبطال كاش المنح بعد الالتزام (الخطوة الرابعة) عبر مفاتيح identity نفسها — staff لا يعيد اختراع
 * أسماء مفاتيح كاش identity، وidentity منشئ الإبطال هو مصدرها الوحيد.
 *
 * @param redis عميل Redis أو undefined في تطبيق بلا كاش
 * @returns منفذ الإبطال الذي يستخدمه use case الإعطاء
 */
export function createStaffAccessGrantCache(redis?: Redis): StaffAccessGrantCache {
  const invalidator = createGrantInvalidator(redis);
  return {
    invalidate: (input) => invalidator.invalidate(input.companyId, input.membershipId),
  };
}
