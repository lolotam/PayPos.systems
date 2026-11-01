import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { AuthDatabase } from '../auth-database.ts';
import { staffPrivateViewIdentifier, staffPrivateViewSequenceIdentifier } from './identifiers.ts';
import { timestamp, toDate } from './timestamp.ts';
import type { StaffPrivateViewDecisionRow, StaffPrivateViewSessionRow } from './types.ts';

/**
 * قرار الفتح: العينة اللي اتؤخذت تحت قفل صف الجلسة ونهاية السقف.
 * auth هو اللي بيحسبها؛ packages/db ما بيحسبش وقت.
 */
export type StaffPrivateViewOpenDecision = {
  readonly now: Date;
  readonly expiresAt: Date;
};

/** طلب فتح نافذة: قيم محسوبة في auth، والقرار كله ملك auth. */
export type StaffPrivateViewOpenRequest = {
  readonly sessionId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly windowId: string;
  /** مفتاح صف النافذة الجديدة. */
  readonly windowRowId: string;
  /** مفتاح صف عداد الجلسة لو اتشال. */
  readonly counterRowId: string;
  /**
   * قرار auth تحت قفل صف الجلسة؛ null يعني رفض بدون أي كتابة.
   * القرار غير الفارض عقد: الصف موجود وموعده صالح، وإلا رميت الدالة خطأ عقد.
   */
  readonly accept: (
    row: StaffPrivateViewDecisionRow | null,
  ) => StaffPrivateViewOpenDecision | null;
};

/** نتيجة الفتح: ترتيب النافذة والعينة اللي اتكتبت بها، أو رفض بدون كتابة. */
export type StaffPrivateViewOpenOutcome =
  | {
      readonly kind: 'opened';
      readonly windowSeq: string;
      /** العينة اللي اتؤخذت تحت قفل صف الجلسة. */
      readonly now: Date;
      /** القيمة اللي اتكتبت في created_at، وهي نفس العينة. */
      readonly createdAt: Date;
    }
  | { readonly kind: 'refused' };

/**
 * يفتح نافذة الجلسة في معاملة واحدة: قفل صف الجلسة، ثم قرار auth، ثم العدّاد، ثم النافذة.
 * ترتيب القفل ثابت (صف الجلسة قبل verification) عشان ما يتكونش تعارض مع إنهاء الجلسة.
 *
 * @param database واجهة pospay_auth
 * @param request قيم الطلب وقدر auth على رفض الصف المقفل
 * @returns ترتيب النافذة والعينة اللي اتكتبت بها، أو رفضاً ماكتبش فيه سطر واحد
 */
export async function openStaffPrivateView(
  database: AuthDatabase,
  request: StaffPrivateViewOpenRequest,
): Promise<StaffPrivateViewOpenOutcome> {
  return database.db.transaction<StaffPrivateViewOpenOutcome>(async (tx) => {
    const [session] = await tx.execute<StaffPrivateViewSessionRow>(sql`
      SELECT user_id,purpose,staff_device_context,staff_absolute_deadline
      FROM session WHERE id=${request.sessionId}::uuid FOR UPDATE`);
    // التطبيع قبل القرار: الموعد بيتقارن مرة واحدة، والعداد بيكتب نفس القيمة اللي قارنها auth.
    const row = session ? normalizeSessionRow(session) : null;
    const decision = request.accept(row);
    if (decision === null) return { kind: 'refused' };
    const deadline = row === null ? null : row.staff_absolute_deadline;
    if (deadline === null) throw new Error('PRIVATE_VIEW_SESSION_DEADLINE_MISSING');
    const windowSeq = await nextWindowSequence(tx, request, decision, deadline);
    const identifier = staffPrivateViewIdentifier(request.sessionId);
    await tx.execute(sql`DELETE FROM verification WHERE identifier=${identifier}`);
    const value = JSON.stringify({
      window_id: request.windowId,
      window_seq: windowSeq,
      user_id: request.userId,
      device_id: request.deviceId,
    });
    await tx.execute(sql`
      INSERT INTO verification(id,identifier,value,expires_at,created_at,updated_at)
      VALUES(${request.windowRowId},${identifier},${value},
        ${timestamp(decision.expiresAt)},${timestamp(decision.now)},${timestamp(decision.now)})`);
    return { kind: 'opened', windowSeq, now: decision.now, createdAt: decision.now };
  });
}

/**
 * يزيد عداد الجلسة ولا ينشئه، والعداد بيفضل بعد قفل النافذة عشان يبقى الترتيب تصاعدي.
 *
 * @param tx معاملة pospay_auth المفتوحة بالفعل
 * @param request قيم الطلب ومعرّفات الصفوف
 * @param decision العينة اللي اتؤخذت تحت القفل
 * @param deadline الموعد المطلق للجلسة، وهو نهاية العدّاد
 * @returns رقم الترتيب العشري للنافذة
 */
async function nextWindowSequence(
  tx: Pick<PostgresJsDatabase, 'execute'>,
  request: StaffPrivateViewOpenRequest,
  decision: StaffPrivateViewOpenDecision,
  deadline: Date,
): Promise<string> {
  const counter = staffPrivateViewSequenceIdentifier(request.sessionId);
  const [updated] = await tx.execute<{ value: string }>(sql`
    UPDATE verification SET value=(value::bigint+1)::text,expires_at=${timestamp(deadline)},updated_at=${timestamp(decision.now)}
    WHERE identifier=${counter} RETURNING value`);
  if (updated !== undefined) return updated.value;
  const [inserted] = await tx.execute<{ value: string }>(sql`
    INSERT INTO verification(id,identifier,value,expires_at,created_at,updated_at)
    VALUES(${request.counterRowId},${counter},'1',${timestamp(deadline)},${timestamp(decision.now)},${timestamp(decision.now)})
    RETURNING value`);
  if (inserted === undefined) throw new Error('PRIVATE_VIEW_COUNTER_UNAVAILABLE');
  return inserted.value;
}

/**
 * يطبّع صف الجلسة المقفل قبل القرار: الموعد بيتحوّل لتاريخ هنا مرة واحدة.
 * صف من غير موعد صالح مابيشتغلش مع النافذة، فالقرار في auth بيشوف null بدل تاريخ مكسور.
 *
 * @param row الصف كما وصل من القاعدة
 * @returns صف القرار بموعد تاريخ، أو null لما الموعد ناقص أو تالف
 */
function normalizeSessionRow(row: StaffPrivateViewSessionRow): StaffPrivateViewDecisionRow {
  const raw = row.staff_absolute_deadline;
  if (raw === null) return { ...row, staff_absolute_deadline: null };
  const deadline = toDate(raw);
  return { ...row, staff_absolute_deadline: Number.isNaN(deadline.getTime()) ? null : deadline };
}
