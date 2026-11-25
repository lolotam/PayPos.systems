import { OWNER_ROLE_ID, StaffPhoneTakenError, type TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { Tx } from '@pospay/db';

import {
  cancelStaffUser,
  hashStaffPin,
  provisionStaffUser,
  readStaffAccessAuthority,
  saveTemporaryStaffPin,
  staffPinSetByOtherEvent,
} from '../../identity/index.ts';
import { StaffAccessError } from '../domain/errors.ts';
import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import type { OutboxWriter } from '../../../shared/ports/outbox-writer.port.ts';
import type {
  CancelPendingScope,
  CancelPendingStaffAccessSteps,
  ResetEmployeeStaffPinScope,
  ResetEmployeeStaffPinSteps,
  StaffAccessActor,
  StaffAccessUserSteps,
} from '../ports/staff-access.port.ts';
import type { AuthFacadeForStaffAccess } from '../ports/staff-access-auth.port.ts';
import { lockCompanyRow, lockRecordWithEmployee } from './staff-access-rows.ts';

interface CancelInput {
  readonly businessId: string;
  readonly employeeId: string;
  readonly ids: { newId(): string };
  readonly at: Date;
}

/** نطاق إعادة الضبط — نفس مدخلات خطوة الإلغاء (نشاط وموظفة ومعرّفات ولحظة). */
type ResetInput = CancelInput;

/** خطوة auth في «إعطاء الدخول» عبر identity (plan §2.1) مع ترجمة رفض الهاتف المملوك (FR-F1-5). */
export function createStaffAccessUserSteps(auth: AuthFacadeForStaffAccess): StaffAccessUserSteps {
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
          recordState: input.recordState,
          resetBinding: input.resetBinding,
          ...(input.attemptId === undefined ? {} : { attemptId: input.attemptId }),
        });
      } catch (error) {
        if (error instanceof StaffPhoneTakenError)
          throw new StaffAccessError('STAFF_ACCESS_PHONE_TAKEN');
        throw error;
      }
    },
    accountExists: async (operationId) => (await auth.bindingOf(operationId)) !== null,
    hash: (pin) => hashStaffPin(pin),
  };
}

/**
 * يبني مُنفّذ حذف مستخدم الموظفة عبر identity — المسار الوحيد لحذف الحساب (FR-F1-6).
 *
 * @param auth واجهة حساب الموظفة عبر identity
 * @returns المُنفّذ الذي يستخدمه use case الإلغاء بعد نقل السجل إلى CANCELLING
 */
export function createStaffAccessCancelUser(auth: AuthFacadeForStaffAccess) {
  return (input: {
    operationId: string;
    companyId: string;
    actorUserId: string;
    ids: { newId(): string };
  }) => cancelStaffUser(auth, input);
}

/**
 * فحص `manage:staff-access:branch` على فرع محدد جوه معاملة الشركة — نفس القاعدة للإلغاء
 * وإعادة الضبط، عشان سحب الصلاحية أثناء المعاملة ما يعديش في أي منهم.
 */
function staffAccessAuthority(
  tx: Tx,
  actor: StaffAccessActor,
): (businessId: string, branchId: string) => Promise<boolean> {
  return (businessId, branchId) =>
    readStaffAccessAuthority(tx, {
      companyId: actor.companyId,
      actorUserId: actor.userId,
      businessId,
      branchId,
    });
}

function cancelScope(
  tx: Tx,
  actor: StaffAccessActor,
  input: CancelInput,
  audit: AuditTrail,
): CancelPendingScope {
  return {
    lock: async () => {
      // ترتيب الأقفال الموحد (P1-3): الشركة ← الموظفة ← سجل الدخول.
      if (!(await lockCompanyRow(tx, actor.companyId))) return { employee: null, record: null };
      return lockRecordWithEmployee(tx, actor.companyId, input);
    },
    authority: staffAccessAuthority(tx, actor),
    actorIsOwner: async () => {
      const rows = await tx.execute(sql`SELECT 1 FROM memberships
        WHERE company_id=${actor.companyId} AND user_id=${actor.userId}
          AND role_id=${OWNER_ROLE_ID}::uuid
          AND role_owner_key='global' AND scope_type='COMPANY' AND scope_id=${actor.companyId}
          AND starts_at<=clock_timestamp() AND (ends_at IS NULL OR ends_at>clock_timestamp())
        LIMIT 1`);
      return rows.length !== 0;
    },
    markCancelling: (recordId) =>
      markCancellingRow(tx, actor.companyId, recordId, input.at, audit, input.employeeId),
    restoreStopped: (recordId) =>
      restoreStoppedRow(tx, actor.companyId, recordId, input.at, audit, input.employeeId),
    deleteRecord: (recordId) =>
      deleteCancellingRecord(tx, actor.companyId, recordId, audit, input.employeeId),
  };
}

/** يعيد حساباً سبق التزامه إلى STOPPED بلا تعديل مراجع المستخدم أو ربط هاتف auth. */
async function restoreStoppedRow(
  tx: Tx,
  companyId: string,
  recordId: string,
  at: Date,
  audit: AuditTrail,
  employeeId: string,
): Promise<boolean> {
  const moved = await tx.execute(sql`UPDATE employee_staff_access
    SET state='STOPPED',updated_at=${at.toISOString()}::timestamptz
    WHERE company_id=${companyId} AND id=${recordId} AND user_id IS NOT NULL
      AND state IN ('PENDING','CANCELLING') RETURNING id`);
  if (moved.length === 0) return false;
  await audit.record({
    entity: 'employee_staff_access',
    entityId: recordId,
    action: 'regrant_cancelled',
    after: { employee_id: employeeId, state: 'STOPPED' },
  });
  return true;
}

/** ينقل السجل إلى CANCELLING — true انتقل، false لم يعد PENDING (سباق منح متزامن). */
async function markCancellingRow(
  tx: Tx,
  companyId: string,
  recordId: string,
  at: Date,
  audit: AuditTrail,
  employeeId: string,
): Promise<boolean> {
  const moved = await tx.execute(sql`UPDATE employee_staff_access
    SET state='CANCELLING',updated_at=${at.toISOString()}::timestamptz
    WHERE company_id=${companyId} AND id=${recordId} AND state='PENDING' AND user_id IS NULL RETURNING id`);
  if (moved.length === 0) return false;
  await audit.record({
    entity: 'employee_staff_access',
    entityId: recordId,
    action: 'cancelling',
    after: { employee_id: employeeId, reason: 'PENDING_CANCELLED' },
  });
  return true;
}

/** يحذف سجلًا في حالة CANCELLING؛ true حُذف أو حُذف سابقًا، false غيّرت حالته (سباق منح). */
async function deleteCancellingRecord(
  tx: Tx,
  companyId: string,
  recordId: string,
  audit: AuditTrail,
  employeeId: string,
): Promise<boolean> {
  const state = await tx.execute<{ state: string }>(sql`SELECT state FROM employee_staff_access
    WHERE company_id=${companyId} AND id=${recordId}`);
  const current = state[0]?.state;
  if (current === undefined) return true;
  if (current !== 'CANCELLING') return false;
  const removed = await tx.execute(sql`DELETE FROM employee_staff_access
    WHERE company_id=${companyId} AND id=${recordId} AND state='CANCELLING' RETURNING id`);
  if (removed.length === 0) return true;
  await audit.record({
    entity: 'employee_staff_access',
    entityId: recordId,
    action: 'deleted',
    after: { employee_id: employeeId, reason: 'PENDING_CANCELLED' },
  });
  return true;
}

/**
 * يفتح معاملة إلغاء سجل الانتظار على pospay_app — المعاملة الأولى تنقل الحالة، والثانية تحذف.
 *
 * @param database مغلفات الشركة من @pospay/db
 * @returns المنفذ الذي يشغّل الإلغاء داخل معاملته
 */
export function createCancelPendingStaffAccessSteps(
  database: TenantWrappers,
): CancelPendingStaffAccessSteps {
  return {
    run: (actor, input, work) =>
      database.withTenant(
        actor.companyId,
        (tx) => {
          const writers = transactionWriters(tx, input.ids);
          return work(cancelScope(tx, actor, input, writers.audit));
        },
        { userId: actor.userId },
      ),
  };
}

/** نطاق إعادة الضبط: قفل الشركة والموظفة والسجل، ثم فحص السلطة، ثم الكتابة كلها في معاملة واحدة. */
function resetPinScope(
  tx: Tx,
  actor: StaffAccessActor,
  input: ResetInput,
): ResetEmployeeStaffPinScope {
  const writers = transactionWriters(tx, input.ids);
  return {
    lockCompany: () => lockCompanyRow(tx, actor.companyId),
    lock: () => lockRecordWithEmployee(tx, actor.companyId, input),
    authority: staffAccessAuthority(tx, actor),
    saveTemporaryPin: (userId, pinHash) =>
      saveResetPinAndAudit(tx, {
        actor,
        input,
        audit: writers.audit,
        userId,
        pinHash,
      }),
    appendEvent: (payload) => appendPinSetEvent(writers.outbox, payload),
  };
}

/** يحفظ الرقم المؤقت ويسجل تدقيق إعادة الضبط — الفاعل هو المانح، ومفيش رقم سري في الصف. */
async function saveResetPinAndAudit(
  tx: Tx,
  context: {
    readonly actor: StaffAccessActor;
    readonly input: ResetInput;
    readonly audit: AuditTrail;
    readonly userId: string;
    readonly pinHash: string;
  },
): Promise<void> {
  const { actor, input, audit, userId, pinHash } = context;
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
    action: 'staff.pin_reset_temporary',
    after: { set_by: actor.userId, temporary: true },
  });
}

/** يكتب حدث إعادة الضبط في الـ outbox — معرّفات بس، مفيش رقم سري ولا hash. */
async function appendPinSetEvent(
  outbox: OutboxWriter,
  payload: { employeeId: string; userId: string; branchId: string },
): Promise<void> {
  const built = staffPinSetByOtherEvent({
    employee_id: payload.employeeId,
    user_id: payload.userId,
    branch_id: payload.branchId,
  });
  await outbox.append({
    aggregateType: built.aggregateType,
    aggregateId: payload.employeeId,
    eventType: built.eventType,
    payload: built.payload,
  });
}

/**
 * يفتح معاملة إعادة الضبط على pospay_app — القفل وفحص السلطة والرقم المؤقت والتدقيق والحدث
 * في معاملة واحدة، فمفيش رقم اتغيّر من غير ما يكتمل كله.
 *
 * @param database مغلفات الشركة من @pospay/db
 * @returns المنفذ الذي يشغّل شغل إعادة الضبط داخل معاملته
 */
export function createResetEmployeeStaffPinSteps(
  database: TenantWrappers,
): ResetEmployeeStaffPinSteps {
  return {
    run: (actor, input, work) =>
      database.withTenant(
        actor.companyId,
        (tx) => work(resetPinScope(tx, actor, input)),
        { userId: actor.userId },
      ),
  };
}
