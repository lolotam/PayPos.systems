import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type {
  CommissionBlockCode,
  CommissionOpenBlock,
} from '../domain/commission-blocked-correction.ts';
import type {
  CommissionBlockCodeUpdateInput,
  CommissionBlockInsertInput,
  CommissionBlockResolutionInput,
  CommissionOpenBlockInput,
} from '../ports/commission-correction.port.ts';
import type { Clock, IdGenerator } from '../ports/commission-line-projection.port.ts';

type BlockRow = { id: string; code: string };

/**
 * يقرأ التوقوف المفتوح للموظفة والشهر من الفهرس الجزئي؛ الصفوف المحلولة ما بتدخلش
 * في القيد ولا في القراءة، فالخطوة بتعيد استعمال الصف المفتوح الوحيد دايماً (FR-046).
 *
 * @param tx    معاملة withTenant الحالية؛ الأقفال جواها مش بتتضاف
 * @param input النشاط والموظفة وشهر المصدر
 * @returns الصف المفتوح بهويته ورمزه، أو null لو مفيش
 */
export async function readOpenBlock(
  tx: Tx,
  input: CommissionOpenBlockInput,
): Promise<CommissionOpenBlock | null> {
  const rows = await tx.execute<BlockRow>(sql`SELECT id::text AS id, code
    FROM commission_blocked_corrections
    WHERE company_id = app_company_id() AND business_id = ${input.businessId}::uuid
      AND employee_id = ${input.employeeId}::uuid AND source_period = ${input.sourcePeriod}
      AND resolved_at IS NULL`);
  const row = rows[0];
  return row === undefined ? null : { id: row.id, code: row.code as CommissionBlockCode };
}

/**
 * بيسجّل التوقوف برمزه والشهر المحتجز وكشفه المرسوم مرة واحدة من لقطة قفل الحدث
 * نفسه (CM-53b)، والحل بييجي دايماً مفتوح لأن الإدخال ما بيحطش resolved_at أصلاً.
 *
 * @param tx    معاملة withTenant الحالية؛ ما ينفع تفتح معاملة تانية
 * @param ids   مولّد هوية الصف المحقون
 * @param clock ساعة لحظة التسجيل المحقونة
 * @param input الرمز والحدث الأول والشهر المحتجز وكشفه
 * @returns هوية الصف المكتوب
 */
export async function insertBlock(
  tx: Tx,
  ids: IdGenerator,
  clock: Clock,
  input: CommissionBlockInsertInput,
): Promise<string> {
  const id = ids.newId();
  await tx.execute(sql`INSERT INTO commission_blocked_corrections(
    company_id,id,business_id,employee_id,source_period,code,first_event_id,target_period,
    target_statement_id,created_at)
    VALUES (app_company_id(),${id}::uuid,${input.businessId}::uuid,${input.employeeId}::uuid,
      ${input.sourcePeriod},${input.code},${input.firstEventId}::uuid,
      ${input.targetPeriod},${input.targetStatementId}::uuid,${clock.now().toISOString()}::timestamptz)`);
  return id;
}

/**
 * بيبدّل رمز التوقوف المفتوح بس (CM-52b)؛ فلترة resolved_at IS NULL مع كل تحديث
 * هي الدرع التانية بعد التريغر، وصف مفقود هنا كسر ثابت مش مسار متوقّع.
 *
 * @param tx    معاملة withTenant الحالية
 * @param input هوية الصف والرمز الجديد
 */
export async function updateBlockCode(
  tx: Tx,
  input: CommissionBlockCodeUpdateInput,
): Promise<void> {
  const rows = await tx.execute<BlockRow>(sql`UPDATE commission_blocked_corrections
    SET code = ${input.code}
    WHERE company_id = app_company_id() AND business_id = ${input.businessId}::uuid
      AND id = ${input.blockId}::uuid AND resolved_at IS NULL
    RETURNING id`);
  if (rows.length === 0) {
    throw new Error('the open blocked correction row is missing for its code update');
  }
}

/**
 * بيحلّ التوقوف بلحظة الحل من الساعة المحقونة وجيل الخطوة اللي نجحت ونشرت (Q3)،
 * والزوج بيتكتب مع بعض عشان قيد الزوج ما يرفضش نص حل.
 *
 * @param tx    معاملة withTenant الحالية
 * @param clock ساعة لحظة الحل المحقونة
 * @param input هوية الصف وجيل الخطوة الحالّة
 */
export async function resolveBlock(
  tx: Tx,
  clock: Clock,
  input: CommissionBlockResolutionInput,
): Promise<void> {
  const rows = await tx.execute<BlockRow>(sql`UPDATE commission_blocked_corrections
    SET resolved_at = ${clock.now().toISOString()}::timestamptz,
      resolved_generation = ${input.generation}
    WHERE company_id = app_company_id() AND business_id = ${input.businessId}::uuid
      AND id = ${input.blockId}::uuid AND resolved_at IS NULL
    RETURNING id`);
  if (rows.length === 0) {
    throw new Error('the open blocked correction row is missing for its resolution');
  }
}
