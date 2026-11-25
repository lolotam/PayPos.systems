import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';

import { deleteStaffPrivateViewRows } from './staff-private-view.ts';
import type { IdGenerator, Tx } from './with-tenant.ts';

/**
 * مدخل تغيير هاتف موظفة (spec 076 F3-1، الخطوة الثانية على pospay_auth): معرّف العملية والشركة
 * يثبتان أن المستخدم حساب موظفة لهذه الشركة بالذات، ومعرّف المحاولة يجعل التكرار بعد انقطاع بلا أثر ثانٍ.
 */
export interface StaffPhoneChangeInput {
  /** معرّف عملية سجل الدخول — هوية الاستئناف نفسها المكتوبة على المستخدم. */
  readonly operationId: string;
  /** الشركة التي يجب أن يطابقها ماركر المستخدم. */
  readonly companyId: string;
  /** حساب الموظفة المطلوب تغيير هاتفه. */
  readonly userId: string;
  /** الهاتف الكانوني الجديد. */
  readonly phone: string;
  /** المانح الذي أقرّ الهاتف — يُكتب في تدقيق المنصة. */
  readonly actorUserId: string;
  /** معرّف محاولة التغيير الحالية من سجل الدخول؛ بصمة صف التدقيق الثابتة. */
  readonly attemptId: string;
  /** مولّد UUID v7 لصفوف المنصة. */
  readonly ids: IdGenerator;
}

/**
 * ما تحتاجه الخطوة من الواجهة الأم دون استيراد دائري: تشغيل معاملة على pospay_auth وقفل الهاتف وفئات
 * الرفض المتوقعة. الأخطاء تُبنى عند الحاجة فقط.
 */
export interface StaffPhoneChangeKit {
  /** يشغّل الشغل داخل معاملة auth المحدودة. */
  readonly run: <T>(work: (tx: Tx) => Promise<T>) => Promise<T>;
  /** يقفل الهاتف على نفس مفتاح تدفق المنح ويعيد ساعة قاعدة البيانات. */
  readonly lock: (tx: Tx, hash: Uint8Array) => Promise<Date>;
  /** يترجم سباق الملكية (قيد التفرد) إلى رفض الهاتف المملوك. */
  readonly translatePhoneRace: <T>(write: () => Promise<T>) => Promise<T>;
  /** رفض الهاتف المملوك لمستخدم آخر. */
  readonly phoneTaken: () => Error;
  /** رفض مستخدم ليس حساب موظفة لهذه الشركة بهذه العملية. */
  readonly notStaff: () => Error;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE = /^[+][1-9][0-9]{7,14}$/;

function assertPhoneChangeInput(input: StaffPhoneChangeInput): void {
  const ids = [input.operationId, input.companyId, input.userId, input.actorUserId, input.attemptId];
  if (!ids.every((value) => UUID.test(value)) || !PHONE.test(input.phone))
    throw new Error('STAFF_USER_INPUT_INVALID');
}

/** معرّف صف التدقيق: ثابت لكل (محاولة، مستخدم) بلا أي رقم هاتف فيه، فالتكرار لا يكتب صفاً ثانياً. */
function phoneChangeAuditId(attemptId: string, userId: string): string {
  const digest = createHash('sha256').update(`staff-phone-change:${attemptId}:${userId}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = 0x70 | (bytes.readUInt8(6) & 0x0f);
  bytes[8] = 0x80 | (bytes.readUInt8(8) & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * يغيّر هاتف حساب موظفة لهذه الشركة فقط داخل معاملة auth واحدة: يتحقق من الماركر ومعرّف العملية
 * تحت قفل الصف، يرفض هاتفاً مملوكاً لمستخدم آخر، ينهي كل جلسات STAFF_POS وSTAFF_PERSONAL مع نوافذ
 * العرض الخاصة بها، ويثبّت الهاتف والاعتماد على خطوتين (تغيير الهاتف يشغّل trigger الإبطال).
 * صف اعتماد التدقيق يُكتب أولاً بمعرّف ثابت للمحاولة: وجوده يعني أن المحاولة نفسها نُفّذت كاملة قبل
 * ذلك، فالتكرار يرجع بلا أثر. لا هاتف كامل ولا رقم سري في أي صف.
 *
 * @param kit   أدوات المعاملة والقفل وفئات الرفض من الواجهة الأم
 * @param input الحساب والشركة والعملية والهاتف الجديد والمحاولة
 */
export async function changeStaffUserPhone(
  kit: StaffPhoneChangeKit,
  input: StaffPhoneChangeInput,
): Promise<void> {
  assertPhoneChangeInput(input);
  return kit.run(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.operationId}, 0))`);
    const [bound] = await tx.execute<{
      company: string | null;
      operation: string | null;
      phone: string | null;
      approved: boolean;
    }>(sql`
      SELECT staff_access_company_id AS company, staff_access_operation_id AS operation,
        phone_number AS phone, phone_binding_approved_at IS NOT NULL AS approved
      FROM "user" WHERE id = ${input.userId} FOR UPDATE`);
    if (bound === undefined || bound.company !== input.companyId || bound.operation !== input.operationId)
      throw kit.notStaff();
    const at = await kit.lock(tx, createHash('sha256').update(`staff-provision:${input.phone}`).digest());
    const details = JSON.stringify({ user_id: input.userId, attempt_id: input.attemptId });
    const written = await tx.execute<{ written: number }>(sql`
      INSERT INTO platform_audit_log (id, actor, action, target_user_id, details)
      VALUES (${phoneChangeAuditId(input.attemptId, input.userId)}, ${input.actorUserId},
        'phone.binding_approved', NULL, ${details}::jsonb)
      ON CONFLICT DO NOTHING
      RETURNING 1 AS written`);
    // صف المحاولة الموجود لا يكفي وحده: لازم الهاتف المطلوب مثبت ومعتمد فعلاً، وإلا تُكمل الخطوة كاملة.
    if (written.length === 0 && bound.phone === input.phone && bound.approved) return;
    const [taken] = await tx.execute<{ id: string }>(
      sql`SELECT id FROM "user" WHERE phone_number = ${input.phone} AND id <> ${input.userId} LIMIT 1`,
    );
    if (taken !== undefined) throw kit.phoneTaken();
    const removed = await tx.execute<{ id: string }>(sql`
      DELETE FROM session WHERE user_id = ${input.userId}
        AND purpose IN ('STAFF_POS', 'STAFF_PERSONAL') RETURNING id`);
    await deleteStaffPrivateViewRows(tx, removed.map((row) => row.id));
    await kit.translatePhoneRace(() =>
      tx.execute(sql`UPDATE "user" SET phone_number = ${input.phone}, phone_number_verified = false
        WHERE id = ${input.userId}`),
    );
    await tx.execute(sql`UPDATE "user"
      SET phone_binding_approved_at = ${at.toISOString()}::timestamptz WHERE id = ${input.userId}`);
    await tx.execute(sql`INSERT INTO platform_audit_log (id, actor, action, target_user_id, details)
      VALUES (${input.ids.newId()}, ${input.actorUserId}, 'staff.phone_changed', NULL, ${details}::jsonb)`);
  });
}
