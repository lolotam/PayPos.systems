import { StaffPhoneTakenError, type TenantWrappers, type Tx } from '@pospay/db';
import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';

import {
  changeStaffUserPhone,
  clearStaffPin,
  saveTemporaryStaffPin,
  staffPinSetByOtherEvent,
} from '../../identity/index.ts';
import { StaffAccessError } from '../domain/errors.ts';
import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import type { OutboxWriter } from '../../../shared/ports/outbox-writer.port.ts';
import type {
  ChangeEmployeeStaffPhoneScope,
  ChangeEmployeeStaffPhoneSteps,
  StaffAccessActor,
  StaffAccessIds,
  StaffAccessPhoneUserSteps,
} from '../ports/staff-access.port.ts';
import type { AuthFacadeForStaffAccess } from '../ports/staff-access-auth.port.ts';
import { staffAccessAuthority } from './staff-access-auth.adapter.ts';
import { lockCompanyRow, lockRecordWithEmployee } from './staff-access-rows.ts';

interface PhoneChangeInput {
  readonly businessId: string;
  readonly employeeId: string;
  readonly ids: StaffAccessIds;
  readonly at: Date;
}

/** الخطوة الثانية على pospay_auth عبر identity مع ترجمة رفض الهاتف المملوك، وتصوير الرقم السري خارج المعاملات. */
export function createStaffAccessPhoneUserSteps(
  auth: AuthFacadeForStaffAccess,
  hash: (pin: string) => Promise<string>,
): StaffAccessPhoneUserSteps {
  return {
    changePhone: async (input) => {
      try {
        await changeStaffUserPhone(auth, input);
      } catch (error) {
        if (error instanceof StaffPhoneTakenError)
          throw new StaffAccessError('STAFF_ACCESS_PHONE_TAKEN');
        throw error;
      }
    },
    hash,
  };
}

/**
 * بصمة الهاتف المفتاحية — نفس اشتقاق «إعطاء الدخول» بالحرف، فاستئناف التغيير ومقارنة الهاتف لاحقاً
 * يطابقان السجل بلا كشف الهاتف.
 */
function phoneHashOf(secret: Buffer | string, phone: string): string {
  return createHmac('sha256', secret).update('pospay:staff-access:phone:v1\0').update(phone).digest('hex');
}

function phoneScope(
  tx: Tx,
  actor: StaffAccessActor,
  input: PhoneChangeInput,
  phoneHashSecret: Buffer | string,
): ChangeEmployeeStaffPhoneScope {
  const writers = transactionWriters(tx, input.ids);
  return {
    lockCompany: () => lockCompanyRow(tx, actor.companyId),
    lock: () => lockRecordWithEmployee(tx, actor.companyId, input),
    authority: staffAccessAuthority(tx, actor, input.employeeId),
    phoneHash: (phone) => phoneHashOf(phoneHashSecret, phone),
    startChange: (change) => startChange(tx, { actor, input, audit: writers.audit, change }),
    completeChange: (done) => completeChange(tx, { actor, input, audit: writers.audit, done }),
    appendEvent: (payload) =>
      appendPinSetEvent(writers.outbox, payload, { actorUserId: actor.userId, at: input.at }),
  };
}

/**
 * يمسح الرقم السري وأدلة تغييره ثم ينقل السجل إلى PHONE_CHANGING ببصمة الهاتف الجديد، ويكتب تدقيق
 * البداية — كلها في معاملة واحدة، فلا حالة وسطى يقرؤها أحد.
 */
async function startChange(
  tx: Tx,
  context: {
    readonly actor: StaffAccessActor;
    readonly input: PhoneChangeInput;
    readonly audit: AuditTrail;
    readonly change: {
      recordId: string;
      userId: string;
      phoneHash: string;
      resumeAttempt: string | null;
    };
  },
): Promise<string> {
  const { actor, input, audit, change } = context;
  await clearStaffPin(tx, {
    companyId: actor.companyId,
    userId: change.userId,
    actorUserId: actor.userId,
    at: input.at,
    ids: input.ids,
  });
  const attemptId = change.resumeAttempt ?? input.ids.newId();
  await tx.execute(sql`UPDATE employee_staff_access
    SET state='PHONE_CHANGING',phone_hash=${change.phoneHash},attempt_id=${attemptId},
      updated_at=${input.at.toISOString()}::timestamptz
    WHERE company_id=${actor.companyId} AND id=${change.recordId}`);
  await audit.record({
    entity: 'employee_staff_access',
    entityId: change.recordId,
    action: 'phone_change_started',
    after: { employee_id: input.employeeId, state: 'PHONE_CHANGING', attempt_id: attemptId },
  });
  await audit.record({
    entity: 'cashier_pin',
    entityId: change.userId,
    action: 'staff.pin_cleared',
    after: { set_by: actor.userId },
  });
  return attemptId;
}

/** يحفظ الرقم المؤقت الجديد ويعيد السجل إلى ACTIVE ويكتب تدقيق الإتمام بلا هاتف ولا رقم سري. */
async function completeChange(
  tx: Tx,
  context: {
    readonly actor: StaffAccessActor;
    readonly input: PhoneChangeInput;
    readonly audit: AuditTrail;
    readonly done: { recordId: string; userId: string; pinHash: string };
  },
): Promise<void> {
  const { actor, input, audit, done } = context;
  await saveTemporaryStaffPin(tx, {
    companyId: actor.companyId,
    userId: done.userId,
    pinHash: done.pinHash,
    setBy: actor.userId,
    at: input.at,
    ids: input.ids,
  });
  await tx.execute(sql`UPDATE employee_staff_access
    SET state='ACTIVE',updated_at=${input.at.toISOString()}::timestamptz
    WHERE company_id=${actor.companyId} AND id=${done.recordId} AND state='PHONE_CHANGING'`);
  await audit.record({
    entity: 'cashier_pin',
    entityId: done.userId,
    action: 'staff.pin_set_temporary',
    after: { set_by: actor.userId, temporary: true },
  });
  await audit.record({
    entity: 'employee_staff_access',
    entityId: done.recordId,
    action: 'phone_changed',
    after: { employee_id: input.employeeId, state: 'ACTIVE' },
  });
}

/** يكتب حدث الرقم السري المضبوط من غير صاحبته في الـ outbox — معرّفات بس، مفيش رقم ولا هاتف. */
async function appendPinSetEvent(
  outbox: OutboxWriter,
  payload: { employeeId: string; userId: string; branchId: string },
  stamp: { actorUserId: string; at: Date },
): Promise<void> {
  const built = staffPinSetByOtherEvent({
    employee_id: payload.employeeId,
    user_id: payload.userId,
    branch_id: payload.branchId,
    actor_user_id: stamp.actorUserId,
    occurred_at: stamp.at.toISOString(),
  });
  await outbox.append({
    aggregateType: built.aggregateType,
    aggregateId: payload.employeeId,
    eventType: built.eventType,
    payload: built.payload,
  });
}

/**
 * يفتح معاملتي «تغيير الهاتف» على pospay_app: الأولى تمسح الرقم وتنقل السجل إلى PHONE_CHANGING،
 * والثالثة تحفظ الرقم المؤقت الجديد وتعيد ACTIVE والحدث في معاملة واحدة.
 *
 * @param database        مغلفات الشركة من @pospay/db
 * @param phoneHashSecret مفتاح بصمة الهاتف (HMAC) — فاضي يرفع خطأ عند البناء بدل بصمة ضعيفة
 * @returns المنفذ الذي يشغّل شغل كل خطوة داخل معاملتها
 */
export function createChangeEmployeeStaffPhoneSteps(
  database: TenantWrappers,
  phoneHashSecret: Buffer | string,
): ChangeEmployeeStaffPhoneSteps {
  if (phoneHashSecret.length === 0) throw new Error('STAFF_ACCESS_PHONE_HASH_SECRET_EMPTY');
  return {
    run: (actor, input, work) =>
      database.withTenant(actor.companyId, (tx) => work(phoneScope(tx, actor, input, phoneHashSecret)), {
        userId: actor.userId,
      }),
  };
}
