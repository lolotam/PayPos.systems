import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';

import { createOtpRuntime, type OtpRuntime } from './staff-otp-runtime.ts';
import type { IdGenerator } from './with-tenant.ts';

/**
 * واجهة حساب الموظفة على pospay_auth (spec 076 F1، ADR-0003 §2.1): الإنشاء والإيجاد والإلغاء كلها
 * بمعرّف العملية داخل معاملة واحدة، ولا credential account بيتعمل أبداً. الاستيراد مسموح لـ
 * packages/auth فقط — مُدرج في composition_roots.staff-otp-db.
 */

/** رقم مملوك لمستخدم آخر في أي شركة — الرفض المتوقع الوحيد للمسار (SA-Q4، FR-F1-5). */
export class StaffPhoneTakenError extends Error {
  override readonly name = 'StaffPhoneTakenError';
  constructor() {
    super('STAFF_PHONE_TAKEN');
  }
}

/** مدخل الإنشاء أو الإيجاد: معرّف العملية هوية الاستئناف، والمانح هو المؤكِّد للهاتف. */
export interface StaffUserProvisionInput {
  readonly operationId: string;
  readonly companyId: string;
  readonly phone: string;
  readonly name: string;
  readonly actorUserId: string;
  readonly ids: IdGenerator;
}

/** ناتج الإنشاء أو الإيجاد. */
export interface StaffUserProvisioned {
  readonly userId: string;
}

/** نطاق الواجهة: الهاتف كدالة قفل مشتركة مع تدفق OTP على نفس الاتصال. */
export interface StaffAccessDatabaseOptions {
  readonly url: string;
  readonly phoneLockKey: (hash: Uint8Array) => bigint;
}

// نفس شكل رفض OTP: رسالة ثابتة بلا أي بيانات عن الحساب المالك للرقم.
const PHONE_PATTERN = /^[+][1-9][0-9]{6,14}$/;

/** إيميل اصطناعي غير قابل للتسليم على نطاق محجوز — لا يُشتق من الهاتف أبداً (قرار D8). */
export function staffSyntheticEmail(operationId: string): string {
  return `staff-${operationId}@staff.pospay.invalid`;
}

function assertProvisionInput(input: StaffUserProvisionInput): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.operationId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.companyId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.actorUserId) ||
    input.name.trim().length < 1 ||
    input.name.length > 255 ||
    !PHONE_PATTERN.test(input.phone)
  )
    throw new Error('STAFF_USER_INPUT_INVALID');
}

async function provisionStaffUser(
  runtime: OtpRuntime,
  input: StaffUserProvisionInput,
): Promise<StaffUserProvisioned> {
  assertProvisionInput(input);
  return runtime.run(async (tx) => {
    const [existing] = await tx.execute<{ id: string }>(sql`
      SELECT id FROM "user" WHERE staff_access_operation_id = ${input.operationId} LIMIT 1`);
    if (existing !== undefined) return { userId: existing.id };
    // قفل الهاتف يسلسل مع تدفق OTP على نفس المفتاح؛ قيد التفرد هو الحكم النهائي في السباق.
    await runtime.lock(tx, createHash('sha256').update(`staff-provision:${input.phone}`).digest());
    const [taken] = await tx.execute<{ id: string }>(
      sql`SELECT id FROM "user" WHERE phone_number = ${input.phone} LIMIT 1`,
    );
    if (taken !== undefined) throw new StaffPhoneTakenError();
    const userId = input.ids.newId();
    const at = await runtime.now(tx);
    const [inserted] = await tx.execute<{ id: string }>(sql`
      INSERT INTO "user" (id, name, email, email_verified, phone_number, phone_number_verified,
        phone_binding_approved_at, staff_access_company_id, staff_access_operation_id)
      VALUES (${userId}, ${input.name}, ${staffSyntheticEmail(input.operationId)}, true,
        ${input.phone}, false, ${at.toISOString()}::timestamptz,
        ${input.companyId}, ${input.operationId})
      RETURNING id`);
    if (inserted === undefined) throw new Error('STAFF_USER_PROVISION_FAILED');
    await tx.execute(sql`INSERT INTO platform_audit_log (id, actor, action, target_user_id, details)
      VALUES (${input.ids.newId()}, ${input.actorUserId}, 'staff_user.created', ${userId}, '{}'::jsonb)`);
    await tx.execute(sql`INSERT INTO platform_audit_log (id, actor, action, target_user_id, details)
      VALUES (${input.ids.newId()}, ${input.actorUserId}, 'phone.binding_approved', ${userId}, '{}'::jsonb)`);
    return { userId };
  });
}

async function cancelStaffUser(
  runtime: OtpRuntime,
  input: { operationId: string; companyId: string; actorUserId: string; ids: IdGenerator },
): Promise<void> {
  return runtime.run(async (tx) => {
    const removed = await tx.execute<{ id: string }>(sql`
      DELETE FROM "user"
      WHERE staff_access_operation_id = ${input.operationId}
        AND staff_access_company_id = ${input.companyId}
      RETURNING id`);
    if (removed.length === 0) return;
    await tx.execute(sql`INSERT INTO platform_audit_log (id, actor, action, target_user_id, details)
      VALUES (${input.ids.newId()}, ${input.actorUserId}, 'staff_user.cancelled',
        ${removed[0]?.id ?? null}, '{}'::jsonb)`);
  });
}

async function readStaffUser(
  runtime: OtpRuntime,
  operationId: string,
): Promise<{ userId: string; phoneLast3: string | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) throw new Error('STAFF_USER_INPUT_INVALID');
  return runtime.run(async (tx) => {
    const [row] = await tx.execute<{ id: string; phone: string | null }>(sql`
      SELECT id, phone_number AS phone FROM "user"
      WHERE staff_access_operation_id = ${operationId} LIMIT 1`);
    if (row === undefined) return null;
    return {
      userId: row.id,
      phoneLast3: row.phone === null || row.phone.length < 3 ? null : row.phone.slice(-3),
    };
  });
}

async function readStaffUserKind(
  runtime: OtpRuntime,
  userId: string,
): Promise<{ staff: boolean } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  return runtime.run(async (tx) => {
    const [row] = await tx.execute<{ staff: boolean }>(sql`
      SELECT (staff_access_operation_id IS NOT NULL) AS staff FROM "user"
      WHERE id = ${userId} LIMIT 1`);
    return row === undefined ? null : { staff: row.staff === true };
  });
}

/**
 * يبني واجهة حساب الموظفة على pospay_auth؛ الاتصال مملوك للواجهة ويُغلق معها.
 *
 * @param options الاتصال ومفتاح قفل الهاتف المشترك
 * @returns الإنشاء والإيجاد والإلغاء والقراءة
 */
export function createStaffAccessDatabase(options: StaffAccessDatabaseOptions) {
  const runtime = createOtpRuntime(options.url, options.phoneLockKey);
  return {
    provision: (input: StaffUserProvisionInput) => provisionStaffUser(runtime, input),
    cancel: (input: {
      operationId: string;
      companyId: string;
      actorUserId: string;
      ids: IdGenerator;
    }) => cancelStaffUser(runtime, input),
    read: (operationId: string) => readStaffUser(runtime, operationId),
    /** نوع المستخدم بمعرفه: حساب موظفة أم لا — أساس إغلاق مسارات التعامل (D8). */
    byUserId: (userId: string) => readStaffUserKind(runtime, userId),
    warm: () => runtime.warm(),
    close: () => runtime.close(),
  };
}

export type StaffAccessDatabase = ReturnType<typeof createStaffAccessDatabase>;

