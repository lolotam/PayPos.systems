import type { IdGenerator, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { inAppRecipientGroups } from '../domain/not-clocked-in.ts';
import type { BreakNoticeWrite, LockedBreakShift } from '../ports/break-not-returned.port.ts';
import { writeBreakNotice } from './break-not-returned-writes.ts';

/**
 * حالة سطر دفتر الوردية: null يعني مفيش سطر، وsuppressedAt null يعني الإشعار اتسجل خلاص.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة
 * @param shift الوردية
 * @returns حالة السطر أو null
 */
export async function readBreakLedger(
  tx: Tx,
  companyId: string,
  shift: LockedBreakShift,
): Promise<{ readonly suppressedAt: Date | null } | null> {
  const rows = await tx.execute<{ suppressed_at: Date | null }>(sql`
    SELECT suppressed_at FROM attendance_break_not_returned_notices
    WHERE company_id = ${companyId} AND employee_id = ${shift.employeeId}
      AND shift_starts_at = ${shift.startsAt.toISOString()}`);
  const row = rows[0];
  if (row === undefined) return null;
  return { suppressedAt: row.suppressed_at === null ? null : new Date(row.suppressed_at) };
}

/**
 * يحوّل سطر الدفتر المكبوح لإشعار في مكانه: سطر واحد لكل وردية (D-B15)، فالتحويل بيشيل الكبح
 * ويكتب المستلمين ولحظة الاستحقاق من غير سطر تاني.
 *
 * @param tx معاملة الشركة
 * @param ids مولّد المعرفات
 * @param companyId الشركة
 * @param notice حقائق الإشعار الجديد
 * @returns true لو السطر اتحوّل دلوقتي
 */
export async function convertBreakNotReturned(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  notice: BreakNoticeWrite,
): Promise<boolean> {
  const groups = inAppRecipientGroups(notice.recipients);
  const { shift } = notice;
  const updated = await tx.execute<{ id: string }>(sql`
    UPDATE attendance_break_not_returned_notices
    SET suppressed_at = NULL, recipient_count = ${groups.reduce((total, group) => total + group.length, 0)},
      alert_due_at = ${notice.alertAt.toISOString()}, notified_at = ${notice.detectedAt.toISOString()}
    WHERE company_id = ${companyId} AND employee_id = ${shift.employeeId}
      AND shift_starts_at = ${shift.startsAt.toISOString()} AND suppressed_at IS NOT NULL
    RETURNING id`);
  const row = updated[0];
  if (row === undefined) return false;
  await writeBreakNotice(tx, ids, notice, row.id);
  return true;
}
