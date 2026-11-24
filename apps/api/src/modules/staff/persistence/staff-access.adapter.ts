import type { AuthFacadeForStaffAccess } from '../ports/staff-access-auth.port.ts';
import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';

import {
  createGrantInvalidator,
  grantStaffMembership,
  readStaffAccessAuthority,
  saveTemporaryStaffPin,
  staffAccessGrantedEvent,
  type StaffAccessGranted,
} from '../../identity/index.ts';
import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import type { OutboxWriter } from '../../../shared/ports/outbox-writer.port.ts';
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
  lockCompanyRow,
  lockRecordWithEmployee,
  readRecordRow,
  STAFF_ACCESS_EMPLOYEE_COLUMNS,
  toEmployeeRow,
  type StaffAccessEmployeeSqlRow,
} from './staff-access-rows.ts';

interface BeginInput {
  readonly businessId: string;
  readonly employeeId: string;
  readonly ids: IdGenerator;
  readonly at: Date;
}

interface CommitInput extends BeginInput {
  readonly recordId: string;
}

function authorityChecker(tx: Tx, actor: StaffAccessActor): GrantBeginScope['authority'] {
  return (businessId, branchId) =>
    readStaffAccessAuthority(tx, {
      companyId: actor.companyId,
      actorUserId: actor.userId,
      businessId,
      branchId,
    });
}

function beginScope(tx: Tx, actor: StaffAccessActor, input: BeginInput): GrantBeginScope {
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
    restartRecord: async (recordId, binding) => {
      await tx.execute(sql`UPDATE employee_staff_access SET state='PENDING',phone_hash=${binding.phoneHash},
        role_code=${binding.roleCode},branch_id=${binding.branchId},granted_by=${actor.userId},
        updated_at=${input.at.toISOString()}::timestamptz WHERE company_id=${actor.companyId} AND id=${recordId}`);
      const record = await readRecordRow(tx, actor.companyId, input.employeeId);
      if (record === null) throw new Error('STAFF_RECORD_RESTART_FAILED');
      return record;
    },
    phoneHash: (phone) => createHash('sha256').update(`staff-access-phone:${phone}`).digest('hex'),
    insertRecord: (record) => insertPendingRecord(tx, actor, input, audit, record),
  };
}

async function insertPendingRecord(
  tx: Tx,
  actor: StaffAccessActor,
  input: BeginInput,
  audit: AuditTrail,
  record: { roleCode: StaffAccessRole; branchId: string; phoneHash: string },
): Promise<StaffAccessRecordRow & { grantedBy: string; phoneHash: string }> {
  const id = input.ids.newId();
  const operationId = input.ids.newId();
  await tx.execute(sql`INSERT INTO employee_staff_access
    (company_id,id,business_id,employee_id,operation_id,role_code,branch_id,state,granted_by,phone_hash)
    VALUES (${actor.companyId},${id},${input.businessId},${input.employeeId},${operationId},
      ${record.roleCode},${record.branchId},'PENDING',${actor.userId},${record.phoneHash})`);
  await audit.record({
    entity: 'employee_staff_access',
    entityId: id,
    action: 'created',
    after: { employee_id: input.employeeId, role_code: record.roleCode, state: 'PENDING' },
  });
  return {
    id,
    state: 'PENDING',
    roleCode: record.roleCode,
    branchId: record.branchId,
    operationId,
    userId: null,
    membershipId: null,
    createdAt: input.at,
    grantedBy: actor.userId,
    phoneHash: record.phoneHash,
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
    appendEvent: (payload) => appendGrantedEvent(writers.outbox, payload),
  };
}

async function recheckUnderLock(
  tx: Tx,
  actor: StaffAccessActor,
  input: CommitInput,
): Promise<{
  employee: StaffAccessEmployeeRow | null;
  record: StaffAccessRecordRow | null;
}> {
  return lockRecordWithEmployee(tx, actor.companyId, input);
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
  input: BeginInput,
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
  input: BeginInput,
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
): Promise<void> {
  const event: StaffAccessGranted = {
    employee_id: payload.employeeId,
    user_id: payload.userId,
    membership_id: payload.membershipId,
    branch_id: payload.branchId,
    role: payload.role,
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
 * @param database مغلفات الشركة من @pospay/db
 * @returns المنفذ الذي يشغّل شغل كل خطوة داخل معاملتها
 */
export function createGrantEmployeeAccessSteps(
  database: TenantWrappers,
  auth: AuthFacadeForStaffAccess,
): GrantEmployeeAccessSteps {
  return {
    begin: (actor, input, work) =>
      database.withTenant(actor.companyId, (tx) => work(beginScope(tx, actor, input)), {
        userId: actor.userId,
      }),
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
