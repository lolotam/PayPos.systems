import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';

import { createOtpRuntime, type OtpRuntime } from './staff-otp-runtime.ts';
import type { IdGenerator, Tx } from './with-tenant.ts';

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

/** رفض متوقع: خطأ عابر في مجمع auth المحدود (مهلة قفل أو عبور المهلة الكلية أو انقطاع اتصال) — الطلب يُعاد. */
export class StaffAuthBusyError extends Error {
  override readonly name = 'StaffAuthBusyError';
  /** كود ثابت لا يحمل أي بيانات عن الحساب ولا عن السبب الداخلي. */
  readonly code = 'STAFF_AUTH_BUSY';
  constructor() {
    super('STAFF_AUTH_BUSY');
  }
}

const TRANSIENT_AUTH_CODES = new Set([
  '55P03',
  '57014',
  '40P01',
  '40001',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'BOUNDED_DATABASE_UNAVAILABLE',
  'BOUNDED_COMMIT_UNKNOWN',
  'BOUNDED_CONNECT_TIMEOUT',
]);

/**
 * هل غلاف الـ runtime (`OTP_DATABASE_UNAVAILABLE_<code>`) يخفي فشلاً عابراً يصح إعادته؟ مهلة القفل
 * والعبارة وانقطاع الاتصال ومهلة المجمع المحدود تُعدّ عابرة؛ أي كود آخر خطأ حقيقي يبقى 500.
 *
 * خطوة قفل الهاتف تضيف بادئة `PHONE_LOCK_` للكود، فالتصنيف يجري على الكود الأصلي قبل البادئة —
 * وإلا ضاع انقطاع الاتصال ومهلة المجمع المحدود ودفع الطلب إلى 500 بدل إعادة المحاولة.
 */
export function isTransientAuthFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return false;
  const wrapped = error.message.startsWith('OTP_DATABASE_UNAVAILABLE_') || error.message.startsWith('OTP_PHONE_LOCK_');
  const raw = code.startsWith('PHONE_LOCK_') ? code.slice('PHONE_LOCK_'.length) : code;
  return wrapped && TRANSIENT_AUTH_CODES.has(raw);
}

/**
 * هل الخطأ انتهاك قيد تفرد هاتف المستخدم بالذات؟ يفحص الخطأ وسلسلة cause (Drizzle يغلف خطأ
 * PostgreSQL) على SQLSTATE 23505 واسم القيد `user_phone_number_key` فقط — أي قيد آخر يبقى كما هو.
 */
export function isPhoneUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    const link = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (link.code === '23505' && link.constraint_name === 'user_phone_number_key') return true;
    current = link.cause;
  }
  return false;
}

/** يشغّل كتابة هاتف ويترجم سباق الملكية (رقم أُعطي لمستخدم آخر بعد القراءة) إلى الرفض المتوقع (CLAUDE.md §5). */
export async function translatingPhoneRace<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isPhoneUniqueViolation(error)) throw new StaffPhoneTakenError();
    throw error;
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
  /**
   * معرّف المحاولة التي نفّذت الخطوة — بيتكتب في صف اعتماد الربط عشان تكرار المحاولة نفسها
   * مايعملش اعتماداً ثانياً ولا صف تدقيق ثاني (AC-ACT-2). اختياري: من غيره المولّد العادي هو
   * اللي بيكتب والسلوك زي ما هو.
   */
  readonly attemptId?: string;
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

/**
 * ميزانية معاملة F1 على pospay_auth: أوسع من نافذة قبول OTP (ثانية وقيد 500 ms) لأن منح الدخول طلب
 * مدير لا نافذة قبول، وتحت حمل الخادم تقتل الثانية الواحدة معاملة سليمة بـ CONNECTION_CLOSED (500).
 */
const STAFF_ACCESS_BUDGET_MS = 5000;
const STAFF_ACCESS_STATEMENT_MS = 3000;
const staffAccessRun = <T>(runtime: OtpRuntime, work: (tx: Tx) => Promise<T>) =>
  runtime.run(work, new Date(Date.now() + STAFF_ACCESS_BUDGET_MS), {
    statementMs: STAFF_ACCESS_STATEMENT_MS,
  });

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
    (input.attemptId !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.attemptId)) ||
    input.name.trim().length < 1 ||
    input.name.length > 255 ||
    input.email.length < 3 ||
    input.email.length > 320 ||
    !EMAIL_PATTERN.test(input.email) ||
    !PHONE_PATTERN.test(input.phone)
  )
    throw new Error('STAFF_USER_INPUT_INVALID');
}

/**
 * تفاصيل صف اعتماد ربط الهاتف: هوية المستخدم ومعرّف المحاولة التي اعتمدته. `attempt_id` موجود
 * وقت ما تكون المحاولة معروفة — وهو اللي بيفرّق بين محاولتين على نفس المستخدم (AC-ACT-2).
 */
function bindingDetails(userId: string, attemptId: string | undefined): Record<string, string> {
  return attemptId === undefined ? { user_id: userId } : { user_id: userId, attempt_id: attemptId };
}

/**
 * معرّف صف اعتماد الربط: وقت المحاولة وبتات النسخة بتوعها، والباقي دايجست (المحاولة، المستخدم،
 * الهاتف). نفس المحاولة على نفس الهاتف بتدي نفس المعرّف — فالتصادم على المفتاح الأساسي هو
 * الحارس الوحيد ضد تكرار المحاولة (AC-ACT-2)، لأن سجل المنصة insert-only على pospay_auth فما
 * ينفعش القارئ يقرأ صفه عشان يتأكد إنه اتكتب. من غير معرّف محاولة المولّد العادي هو اللي بيكتب.
 */
function bindingAuditId(input: StaffUserProvisionInput, userId: string): string {
  if (input.attemptId === undefined) return input.ids.newId();
  const attempt = Buffer.from(input.attemptId.replaceAll('-', ''), 'hex');
  const digest = createHash('sha256')
    .update(`staff-binding:${input.attemptId}:${userId}:${input.phone}`)
    .digest();
  attempt[6] = 0x70 | (digest.readUInt8(0) & 0x0f);
  attempt[7] = digest.readUInt8(1);
  attempt[8] = 0x80 | (digest.readUInt8(2) & 0x3f);
  digest.copy(attempt, 9, 3, 10);
  const hex = attempt.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * يكتب صف اعتماد ربط الهاتف في سجل المنصة. المعرّف ثابت لكل (محاولة، مستخدم، هاتف)، فالتكرار
 * مايكتبش صفين — والتصادم على المفتاح هو اللي بيقول إن المحاولة دي اتنفذت قبل كده (AC-ACT-2).
 *
 * `ON CONFLICT DO NOTHING` من غير هدف محدد و`RETURNING 1` بقيمة ثابتة: سجل المنصة insert-only
 * على pospay_auth، فأي `RETURNING` لعمود من الجدول أو أي هدف صراع بيطلب صلاحية SELECT ما
 * عندهاش. الصف المكتوب بيرجع صف واحد، والتصادم بيرجع صفر.
 *
 * @returns الصفوف المكتوبة فعلاً: صف واحد للمحاولة الجديدة، ولا شيء لتكرار المحاولة
 */
async function writeBindingAudit(
  tx: Tx,
  input: StaffUserProvisionInput,
  userId: string,
): Promise<{ written: number }[]> {
  return tx.execute<{ written: number }>(sql`
    INSERT INTO platform_audit_log (id, actor, action, target_user_id, details)
    VALUES (${bindingAuditId(input, userId)}, ${input.actorUserId}, 'phone.binding_approved', NULL,
      ${JSON.stringify(bindingDetails(userId, input.attemptId))}::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING 1 AS written`);
}

/**
 * هل المحاولة نفسها اعتمدت الربط قبل كده؟ لازم الهاتف هو المطلوب، والاعتماد قايم؛ ووجود صف
 * المحاولة (تصادم المفتاح) هو دليل وجوده. نفس المحاولة مايعملش اعتماداً ثانياً ولا صفاً ثانياً
 * (AC-ACT-2).
 */
async function attemptAlreadyApproved(
  tx: Tx,
  input: StaffUserProvisionInput,
  userId: string,
): Promise<boolean> {
  const [bound] = await tx.execute<{ phone: string | null; approved: boolean }>(sql`
    SELECT phone_number AS phone, phone_binding_approved_at IS NOT NULL AS approved
    FROM "user" WHERE id = ${userId}`);
  if (bound?.phone !== input.phone || bound.approved !== true) return false;
  return (await writeBindingAudit(tx, input, userId)).length === 0;
}

async function provisionStaffUser(
  runtime: OtpRuntime,
  input: StaffUserProvisionInput,
): Promise<StaffUserProvisioned> {
  assertProvisionInput(input);
  return staffAccessRun(runtime, async (tx) => {
    // التسلسل على معرّف العملية قبل أي قراءة: استئنافان لنفس العملية لا يتداخلان ولا يقرأان قبل القفل (P1-4).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.operationId}, 0))`);
    const [existing] = await tx.execute<{ id: string; phone: string | null; company: string }>(sql`
      SELECT id, phone_number AS phone, staff_access_company_id AS company FROM "user"
      WHERE staff_access_operation_id = ${input.operationId} LIMIT 1`);
    if (input.recordState !== 'PENDING') throw new StaffRecordNotPendingError();
    const at = await runtime.now(tx);
    if (existing !== undefined) {
      if (
        existing.company !== input.companyId ||
        (!input.resetBinding && existing.phone !== input.phone)
      )
        throw new StaffRecordNotPendingError();
      if (input.resetBinding) await resetStaffBinding(tx, runtime, input, existing.id, at);
      return { userId: existing.id };
    }
    // قفل الهاتف يسلسل بين طلبات F1 نفسها فقط: مفتاحه مشتق من sha256 للهاتف، بينما OTP وربط المنصة
    // يقفلان بصمة HMAC مختلفة، فقيد التفرد هو الحكم النهائي ويُترجم انتهاكه إلى رفض الهاتف المملوك.
    await runtime.lock(tx, createHash('sha256').update(`staff-provision:${input.phone}`).digest());
    const [taken] = await tx.execute<{ id: string }>(
      sql`SELECT id FROM "user" WHERE phone_number = ${input.phone} LIMIT 1`,
    );
    if (taken !== undefined) throw new StaffPhoneTakenError();
    const userId = input.ids.newId();
    const [inserted] = await translatingPhoneRace(() =>
      tx.execute<{ id: string }>(sql`
      INSERT INTO "user" (id, name, email, email_verified, phone_number, phone_number_verified,
        phone_binding_approved_at, staff_access_company_id, staff_access_operation_id)
      VALUES (${userId}, ${input.name}, ${input.email}, true,
        ${input.phone}, false, ${at.toISOString()}::timestamptz,
        ${input.companyId}, ${input.operationId})
      RETURNING id`),
    );
    if (inserted === undefined) throw new Error('STAFF_USER_PROVISION_FAILED');
    // سجل المنصة insert-only ولا يشير بالـ FK: هوية الحساب تعيش في details ليصلح حذفه لاحقاً
    // إلغاءً بعد انتهاء مدة الانتظار (FR-F1-6).
    await tx.execute(sql`INSERT INTO platform_audit_log (id, actor, action, target_user_id, details)
      VALUES (${input.ids.newId()}, ${input.actorUserId}, 'staff.created', NULL,
        ${JSON.stringify({ user_id: userId })}::jsonb)`);
    const audited = await writeBindingAudit(tx, input, userId);
    // مستحيل: المستخدم جديد ومعرّف المحاولة جديد — والتصادم معناه إن في صف لنفس (المحاولة، المستخدم).
    if (audited.length === 0) throw new Error('STAFF_USER_PROVISION_FAILED');
    return { userId };
  });
}

async function resetStaffBinding(
  tx: Tx,
  runtime: OtpRuntime,
  input: StaffUserProvisionInput,
  userId: string,
  at: Date,
): Promise<void> {
  // سجل STOPPED يستأنف بهاتف الطلب: الهاتف إما مالكه المستخدم نفسه أو حر. التثبيت على خطوتين
  // مثل otpApprovePhone — تغيير الهاتف يشغّل trigger الإبطال، فالاعتماد في أمر تالٍ بعده (P1-4).
  await runtime.lock(tx, createHash('sha256').update(`staff-provision:${input.phone}`).digest());
  const [taken] = await tx.execute<{ id: string }>(
    sql`SELECT id FROM "user" WHERE phone_number = ${input.phone} AND id <> ${userId} LIMIT 1`,
  );
  if (taken !== undefined) throw new StaffPhoneTakenError();
  // تكرار المحاولة نفسها: الربط اتأكد على نفس الهاتف من قبل — لا اعتماد جديد ولا صف تدقيق جديد
  // (AC-ACT-2). المحاولة الجديدة على نفس الهاتف بتعدّي من غير ما تكتب صفين.
  if (input.attemptId !== undefined && (await attemptAlreadyApproved(tx, input, userId))) return;
  await translatingPhoneRace(() =>
    tx.execute(sql`UPDATE "user"
    SET phone_number = ${input.phone}, phone_number_verified = false
    WHERE id = ${userId}`),
  );
  await tx.execute(sql`UPDATE "user"
    SET phone_binding_approved_at = ${at.toISOString()}::timestamptz
    WHERE id = ${userId}`);
  await writeBindingAudit(tx, input, userId);
}

async function cancelStaffUser(
  runtime: OtpRuntime,
  input: { operationId: string; companyId: string; actorUserId: string; ids: IdGenerator },
): Promise<void> {
  return staffAccessRun(runtime, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.operationId}, 0))`);
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
  return staffAccessRun(runtime, async (tx) => {
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

/** ربط حساب الموظفة بمعرّف العملية: المستخدم المطلوب فقط، ولا تحقيق عبر صفوف أخرى (P1-5). */
async function readStaffUserBinding(
  runtime: OtpRuntime,
  operationId: string,
): Promise<{ userId: string; companyId: string | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) return null;
  return staffAccessRun(runtime, async (tx) => {
    const [row] = await tx.execute<{ id: string; company: string | null }>(sql`
      SELECT id, staff_access_company_id AS company FROM "user"
      WHERE staff_access_operation_id = ${operationId} LIMIT 1`);
    return row === undefined ? null : { userId: row.id, companyId: row.company };
  });
}

/**
 * يبني واجهة حساب الموظفة على pospay_auth؛ الاتصال مملوك للواجهة ويُغلق معها.
 *
 * @param options الاتصال ومفتاح قفل الهاتف المشترك
 * @returns الإنشاء والإيجاد والإلغاء والقراءة وإثبات الربط
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
    /** ربط المستخدم بمعرّف العملية — إثبات المنح الوحيد المقبول قبل كتابة عضوية (P1-5). */
    bindingOf: (operationId: string) => readStaffUserBinding(runtime, operationId),
    close: () => runtime.close(),
  };
}

export type StaffAccessDatabase = ReturnType<typeof createStaffAccessDatabase>;
