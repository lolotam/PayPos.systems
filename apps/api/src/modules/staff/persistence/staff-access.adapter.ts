import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import {
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
import type { StaffAccessRole } from '../ports/staff-access.port.ts';
import type {
  GrantBeginScope,
  GrantCommitScope,
  GrantEmployeeAccessSteps,
  StaffAccessActor,
  StaffAccessEmployeeRow,
} from '../ports/staff-access.port.ts';

interface BeginInput {
  readonly businessId: string;
  readonly employeeId: string;
  readonly ids: IdGenerator;
  readonly at: Date;
}

interface CommitInput extends BeginInput {
  readonly recordId: string;
}

const EMPLOYEE_COLUMNS = sql`id, business_id, primary_branch_id, user_id,
  COALESCE(NULLIF(name_en, ''), name_ar, '') AS display_name`;

const RECORD_COLUMNS = sql`id, state, role_code, branch_id, operation_id, user_id, membership_id, created_at`;

type EmployeeSqlRow = {
  id: string;
  business_id: string;
  primary_branch_id: string;
  user_id: string | null;
  display_name: string;
};

type RecordSqlRow = {
  id: string;
  state: StaffAccessRecordRow['state'];
  role_code: StaffAccessRole;
  branch_id: string;
  operation_id: string;
  user_id: string | null;
  membership_id: string | null;
  created_at: Date;
};

function employeeRow(row: EmployeeSqlRow): StaffAccessEmployeeRow {
  return {
    id: row.id,
    businessId: row.business_id,
    primaryBranchId: row.primary_branch_id,
    userId: row.user_id,
    displayName: row.display_name,
  };
}

function recordRow(row: RecordSqlRow): StaffAccessRecordRow {
  return {
    id: row.id,
    state: row.state,
    roleCode: row.role_code,
    branchId: row.branch_id,
    operationId: row.operation_id,
    userId: row.user_id,
    membershipId: row.membership_id,
    createdAt: new Date(row.created_at),
  };
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
    lockEmployee: async () => {
      const [row] = await tx.execute<EmployeeSqlRow>(sql`SELECT ${EMPLOYEE_COLUMNS} FROM employees
        WHERE company_id=${actor.companyId} AND business_id=${input.businessId}
          AND id=${input.employeeId} AND deleted_at IS NULL FOR UPDATE`);
      return row === undefined ? null : employeeRow(row);
    },
    authority: authorityChecker(tx, actor),
    findRecord: async () => {
      const [row] = await tx.execute<RecordSqlRow>(sql`SELECT ${RECORD_COLUMNS}
        FROM employee_staff_access
        WHERE company_id=${actor.companyId} AND employee_id=${input.employeeId}`);
      return row === undefined ? null : recordRow(row);
    },
    insertRecord: (record) => insertPendingRecord(tx, actor, input, audit, record),
  };
}

async function insertPendingRecord(
  tx: Tx,
  actor: StaffAccessActor,
  input: BeginInput,
  audit: AuditTrail,
  record: { roleCode: StaffAccessRole; branchId: string },
): Promise<StaffAccessRecordRow> {
  const id = input.ids.newId();
  const operationId = input.ids.newId();
  await tx.execute(sql`INSERT INTO employee_staff_access
    (company_id,id,business_id,employee_id,operation_id,role_code,branch_id,state,granted_by)
    VALUES (${actor.companyId},${id},${input.businessId},${input.employeeId},${operationId},
      ${record.roleCode},${record.branchId},'PENDING',${actor.userId})`);
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
  };
}

function commitScope(tx: Tx, actor: StaffAccessActor, input: CommitInput): GrantCommitScope {
  const writers = transactionWriters(tx, input.ids);
  return {
    lockCompany: async () => {
      const rows = await tx.execute(sql`SELECT id FROM companies
        WHERE id=${actor.companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`);
      return rows.length === 1;
    },
    recheck: () => recheckUnderLock(tx, actor, input),
    authority: authorityChecker(tx, actor),
    grantMembership: (membership) =>
      grantMembershipAndAudit(tx, actor, input.ids, writers.audit, membership),
    linkEmployee: (userId) => linkEmployeeAndAudit(tx, actor, input, writers.audit, userId),
    saveTemporaryPin: (userId, pinHash) =>
      saveTemporaryPinAndAudit(tx, actor, input, writers.audit, userId, pinHash),
    markActive: (mark) =>
      tx.execute(sql`UPDATE employee_staff_access
        SET state='ACTIVE',user_id=${mark.userId},membership_id=${mark.membershipId},updated_at=${input.at.toISOString()}::timestamptz
        WHERE company_id=${actor.companyId} AND id=${mark.recordId}`).then(() => undefined),
    appendEvent: (payload) => appendGrantedEvent(writers.outbox, payload),
  };
}

async function recheckUnderLock(
  tx: Tx,
  actor: StaffAccessActor,
  input: CommitInput,
): Promise<{ employee: StaffAccessEmployeeRow | null; record: StaffAccessRecordRow | null }> {
  const [employee] = await tx.execute<EmployeeSqlRow>(sql`SELECT ${EMPLOYEE_COLUMNS} FROM employees
    WHERE company_id=${actor.companyId} AND business_id=${input.businessId}
      AND id=${input.employeeId} AND deleted_at IS NULL FOR UPDATE`);
  const [record] = await tx.execute<RecordSqlRow>(sql`SELECT ${RECORD_COLUMNS}
    FROM employee_staff_access
    WHERE company_id=${actor.companyId} AND id=${input.recordId} FOR UPDATE`);
  return {
    employee: employee === undefined ? null : employeeRow(employee),
    record: record === undefined ? null : recordRow(record),
  };
}

async function grantMembershipAndAudit(
  tx: Tx,
  actor: StaffAccessActor,
  ids: IdGenerator,
  audit: AuditTrail,
  membership: { userId: string; branchId: string; role: StaffAccessRole },
): Promise<{ membershipId: string }> {
  const granted = await grantStaffMembership(tx, {
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
): GrantEmployeeAccessSteps {
  return {
    begin: (actor, input, work) =>
      database.withTenant(actor.companyId, (tx) => work(beginScope(tx, actor, input)), {
        userId: actor.userId,
      }),
    commit: (actor, input, work) =>
      database.withTenant(actor.companyId, (tx) => work(commitScope(tx, actor, input)), {
        userId: actor.userId,
      }),
  };
}
