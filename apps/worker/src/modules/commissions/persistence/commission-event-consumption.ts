import { markEventConsumed, type Tx } from '@pospay/db';

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
