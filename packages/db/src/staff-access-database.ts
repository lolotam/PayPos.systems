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
  /** كود ثابت يعبر غلاف الـ runtime كما هو ويترجم للكود 409 في الـ API. */
  readonly code = 'STAFF_PHONE_TAKEN';
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
  /** البريد الاصطناعي الجاهز — يُبنى في packages/auth من النطاق المحجوز الثابت (قرار D8). */
  readonly email: string;
  readonly actorUserId: string;
  readonly ids: IdGenerator;
  /**
   * حالة سجل الدخول في الشركة، مقروءة تحت قفل الصف في الخطوة الأولى — الإنشاء مسموح لسجل
   * `PENDING` فقط، فلا مستخدم جديد لسجل `CANCELLING` ولا لأي حالة أخرى (P1-2).
   */
  readonly recordState: 'PENDING' | 'CANCELLING';
  /** إعادة تثبيت ربط الهاتف على المستخدم الموجود عند استئناف سجل `STOPPED` (plan §4.2 خطوة 2). */
  readonly resetBinding: boolean;
}

/** رفض متوقع: إنشاء مستخدم لسجل دخول ليس في حالة `PENDING`. */
export class StaffRecordNotPendingError extends Error {
  override readonly name = 'StaffRecordNotPendingError';
  readonly code = 'STAFF_RECORD_NOT_PENDING';
  constructor() {
    super('STAFF_RECORD_NOT_PENDING');
  }
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
// العقد أ strict بـ 8–15 رقمًا بعد الـ + (plan §4.1)؛ قاعدة البيانات تسمح بـ 7 والمدخل هنا الأشد.
const PHONE_PATTERN = /^[+][1-9][0-9]{7,14}$/;
// البريد يُبنى في packages/auth من النطاق المحجوز؛ هنا فحص شكل خفيف قبل الكتابة فقط.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertProvisionInput(input: StaffUserProvisionInput): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.operationId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.companyId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.actorUserId) ||
    input.name.trim().length < 1 ||
    input.name.length > 255 ||
    input.email.length < 3 ||
    input.email.length > 320 ||
    !EMAIL_PATTERN.test(input.email) ||
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
    // التسلسل على معرّف العملية قبل أي قراءة: استئنافان لنفس العملية لا يتداخلان ولا يقرأان قبل القفل (P1-4).
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.operationId}, 0))`,
    );
    const [existing] = await tx.execute<{ id: string; phone: string | null }>(sql`
      SELECT id, phone_number AS phone FROM "user"
      WHERE staff_access_operation_id = ${input.operationId} LIMIT 1`);
    const at = await runtime.now(tx);
    if (existing !== undefined) {
      if (input.resetBinding) {
        // سجل STOPPED يستأنف بهاتف الطلب: الهاتف إما مالكه المستخدم نفسه أو حر. التثبيت على خطوتين
        // مثل otpApprovePhone — تغيير الهاتف يشغّل trigger الإبطال، فالاعتماد في أمر تالٍ بعده (P1-4).
        await runtime.lock(tx, createHash('sha256').update(`staff-provision:${input.phone}`).digest());
        const [taken] = await tx.execute<{ id: string }>(
          sql`SELECT id FROM "user" WHERE phone_number = ${input.phone} AND id <> ${existing.id} LIMIT 1`,
        );
        if (taken !== undefined) throw new StaffPhoneTakenError();
        await tx.execute(sql`UPDATE "user"
          SET phone_number = ${input.phone}, phone_number_verified = false
          WHERE id = ${existing.id}`);
        await tx.execute(sql`UPDATE "user"
          SET phone_binding_approved_at = ${at.toISOString()}::timestamptz
          WHERE id = ${existing.id}`);
        await tx.execute(sql`INSERT INTO platform_audit_log (id, actor, action, target_user_id, details)
          VALUES (${input.ids.newId()}, ${input.actorUserId}, 'phone.binding_approved', NULL,
            ${JSON.stringify({ user_id: existing.id })}::jsonb)`);
      }
      return { userId: existing.id };
    }
    if (input.recordState !== 'PENDING') throw new StaffRecordNotPendingError();
    // قفل الهاتف يسلسل مع تدفق OTP على نفس المفتاح؛ قيد التفرد هو الحكم النهائي في السباق.
    await runtime.lock(tx, createHash('sha256').update(`staff-provision:${input.phone}`).digest());
    const [taken] = await tx.execute<{ id: string }>(
      sql`SELECT id FROM "user" WHERE phone_number = ${input.phone} LIMIT 1`,
    );
    if (taken !== undefined) throw new StaffPhoneTakenError();
    const userId = input.ids.newId();
    const [inserted] = await tx.execute<{ id: string }>(sql`
      INSERT INTO "user" (id, name, email, email_verified, phone_number, phone_number_verified,
        phone_binding_approved_at, staff_access_company_id, staff_access_operation_id)
      VALUES (${userId}, ${input.name}, ${input.email}, true,
        ${input.phone}, false, ${at.toISOString()}::timestamptz,
        ${input.companyId}, ${input.operationId})
      RETURNING id`);
    if (inserted === undefined) throw new Error('STAFF_USER_PROVISION_FAILED');
    // سجل المنصة insert-only ولا يشير بالـ FK: هوية الحساب تعيش في details ليصلح حذفه لاحقاً
    // إلغاءً بعد انتهاء مدة الانتظار (FR-F1-6).
    await tx.execute(sql`INSERT INTO platform_audit_log (id, actor, action, target_user_id, details)
      VALUES (${input.ids.newId()}, ${input.actorUserId}, 'staff.created', NULL,
        ${JSON.stringify({ user_id: userId })}::jsonb)`);
    await tx.execute(sql`INSERT INTO platform_audit_log (id, actor, action, target_user_id, details)
      VALUES (${input.ids.newId()}, ${input.actorUserId}, 'phone.binding_approved', NULL,
        ${JSON.stringify({ user_id: userId })}::jsonb)`);
    return { userId };
  });
}

async function cancelStaffUser(
  runtime: OtpRuntime,
  input: { operationId: string; companyId: string; actorUserId: string; ids: IdGenerator },
): Promise<void> {
  return runtime.run(async (tx) => {
    const [existing] = await tx.execute<{ id: string }>(sql`
      SELECT id FROM "user"
      WHERE staff_access_operation_id = ${input.operationId}
        AND staff_access_company_id = ${input.companyId} LIMIT 1`);
    if (existing === undefined) return;
    await tx.execute(sql`INSERT INTO platform_audit_log (id, actor, action, target_user_id, details)
      VALUES (${input.ids.newId()}, ${input.actorUserId}, 'staff.cancelled', NULL,
        ${JSON.stringify({ user_id: existing.id })}::jsonb)`);
    await tx.execute(sql`DELETE FROM "user" WHERE id = ${existing.id}`);
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
): Promise<{ staff: boolean; companyId: string | null; operationId: string | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  // مهلة أوسع من الافتراضي: الفحص يمر بكل جلسة/طلب تعامل ولا يحتمل فشلاً عابراً (P1-6).
  return runtime.run(
    async (tx) => {
      const [row] = await tx.execute<{
        staff: boolean;
        company: string | null;
        operation: string | null;
      }>(sql`
        SELECT (staff_access_operation_id IS NOT NULL) AS staff,
          staff_access_company_id AS company, staff_access_operation_id AS operation
        FROM "user" WHERE id = ${userId} LIMIT 1`);
      return row === undefined
        ? null
        : { staff: row.staff === true, companyId: row.company, operationId: row.operation };
    },
    new Date(Date.now() + 5000),
  );
}

/** هل الحساب (credential) يخص مستخدم موظفة؟ يُفحص قبل أي تحديث حساب عبر id الحساب (P1-6). */
async function readStaffAccountKind(
  runtime: OtpRuntime,
  accountId: string,
): Promise<{ staff: boolean } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return null;
  return runtime.run(async (tx) => {
    const [row] = await tx.execute<{ staff: boolean }>(sql`
      SELECT (u.staff_access_operation_id IS NOT NULL) AS staff
      FROM account a JOIN "user" u ON u.id = a.user_id
      WHERE a.id = ${accountId} LIMIT 1`);
    return row === undefined ? null : { staff: row.staff === true };
  });
}

/** ربط حساب الموظفة بمعرّف العملية: المستخدم المطلوب فقط، ولا تحقيق عبر صفوف أخرى (P1-5). */
async function readStaffUserBinding(
  runtime: OtpRuntime,
  operationId: string,
): Promise<{ userId: string; companyId: string | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) return null;
  return runtime.run(async (tx) => {
    const [row] = await tx.execute<{ id: string; company: string | null }>(sql`
      SELECT id, staff_access_company_id AS company FROM "user"
      WHERE staff_access_operation_id = ${operationId} LIMIT 1`);
    return row === undefined ? null : { userId: row.id, companyId: row.company };
  });
}

/** مستخدم رابط token استهلاك كلمة السر — فحص الاستهلاك قبل تسليم الطلب لـ Better Auth (P1-6). */
async function readUserIdForResetToken(
  runtime: OtpRuntime,
  token: string,
): Promise<string | null> {  if (token.length < 8 || token.length > 256 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  // مهلة أوسع من الافتراضي: فحص الاستهلاك يمر بكل طلب reset ولا يحتمل فشلاً عابراً (P1-6).
  return runtime.run(
    async (tx) => {
      const [row] = await tx.execute<{ value: string }>(sql`
        SELECT value FROM verification
        WHERE identifier = ${`reset-password:${token}`} AND expires_at > now() LIMIT 1`);
      return row?.value ?? null;
    },
    new Date(Date.now() + 5000),
  );
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
    /** نوع المستخدم بمعرفه وهويته في الشركة — أساس إغلاق مسارات التعامل و exclusivity الشركة (D8، P1-5). */
    byUserId: (userId: string) => readStaffUserKind(runtime, userId),
    /** نوع الحساب (credential) بمعرفه — فحص الهدف عند تحديث كلمة السر (P1-6). */
    byAccountId: (accountId: string) => readStaffAccountKind(runtime, accountId),
    /** ربط المستخدم بمعرّف العملية — إثبات المنح الوحيد المقبول قبل كتابة عضوية (P1-5). */
    bindingOf: (operationId: string) => readStaffUserBinding(runtime, operationId),
    /** مستخدم رابط token استهلاك كلمة السر أو null — بوابة الاستهلاك قبل Better Auth (P1-6). */
    userIdForResetToken: (token: string) => readUserIdForResetToken(runtime, token),
    warm: () => runtime.warm(),
    close: () => runtime.close(),
  };
}

export type StaffAccessDatabase = ReturnType<typeof createStaffAccessDatabase>;

