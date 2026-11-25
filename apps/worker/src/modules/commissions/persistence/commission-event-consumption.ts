import { markEventConsumed, type Tx } from '@pospay/db';
import { COMMISSION_INPUTS_CONSUMER_ID } from '@pospay/domain';
import { sql } from 'drizzle-orm';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * يسجّل أن المستهلك طبّق الحدث ده داخل معاملة الزيارة نفسها، فتسجيل الحدث وإسقاط البقشيش
 * يثبتان معاً أو يُلغيان معاً. لو رجّع false فالعنصر ده اتسجّل قبل كده فيُعتبر تطبيق مكرر.
 *
 * @param tx         معاملة الزيارة الجارية من withTenant
 * @param consumerId اسم المستهلك الثابت (commissions.project-inputs)
 * @param eventId    معرّف الحدث من outbox
 * @returns true لو دي أول مرة، false لو اتسجّل قبل كده
 */
export async function markCommissionEventConsumed(
  tx: Tx,
  consumerId: string,
  eventId: string,
): Promise<boolean> {
  return markEventConsumed(tx, consumerId, eventId);
}

/**
 * هل مستهلك مدخلات العمولة طبّق الحدث ده؟ الحدث الموقوف اللي اتسجل عليه ما بيمنعش اعتماد
 * شهر العمولة، فالتنبيه عليه مالهوش لازمة (ADR-0012 §3.1). القراءة جوه معاملة الشركة
 * عشان الصف ما يتقريش من شركة تانية.
 *
 * @param tx      معاملة الشركة الجارية من withTenant
 * @param eventId معرّف الحدث الموقوف من outbox
 * @returns true لو علامة المستهلِك موجودة، false لو مش موجودة
 */
export async function isCommissionInputEventConsumed(
  tx: Tx,
  eventId: string,
): Promise<boolean> {
  if (!UUID.test(eventId)) throw new TypeError('eventId must be a UUID');
  const rows = await tx.execute<{ present: number }>(sql`
    SELECT 1 AS present FROM consumed_events
    WHERE company_id = app_company_id() AND consumer_id = ${COMMISSION_INPUTS_CONSUMER_ID}
      AND event_id = ${eventId}::uuid
    LIMIT 1`);
  return rows.length > 0;
}
