import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** لقطة الرقم المؤقت: مين حطّه ومتى — بلا رقم سري ولا hash. */
export interface TemporaryStaffPinSet {
  readonly setBy: string | null;
  readonly setAt: Date;
}

/**
 * يقرأ لقطة الرقم المؤقت الخاص بمستخدم: مين حطّه ومتى.
 * `set_by` ب.null معناه إن الموظفة غيّرت الرقم بنفسها على الجهاز بعدين، فالفاعل بيتبعت من سجل التدقيق.
 * العمود `pin_hash` ما بيتقراش أبداً: يوصل لإشارات المستلمين ومينفعش يخرج منها.
 *
 * @param tx معاملة المستأجر
 * @param companyId الشركة
 * @param userId المستخدم صاحب الرقم
 * @returns اللقطة أو null إن لم يكن للرقم صف
 */
export async function readTemporaryStaffPinSet(
  tx: Tx,
  companyId: string,
  userId: string,
): Promise<TemporaryStaffPinSet | null> {
  const rows = await tx.execute<{ set_by: string | null; set_at: Date }>(sql`
    SELECT set_by, set_at FROM cashier_pins
    WHERE company_id = ${companyId} AND user_id = ${userId}`);
  const row = rows[0];
  if (row === undefined) return null;
  return { setBy: row.set_by, setAt: new Date(row.set_at) };
}
