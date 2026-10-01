import type { NotificationResult } from '@pospay/contracts';

/** يُكتب مع المحاولة PENDING فقط؛ المستهلك هو ناشر النقل إلى BullMQ ومعه المعرّفان فقط. */
export type NotificationSendAuthorized = {
  readonly company_id: string;
  readonly attempt_id: string;
};
/** يُكتب عند قبول المزود مع SENT أو حفظ IN_APP، ولا يزعم وصول الهاتف أو قراءة المستخدم. */
export type NotificationDelivered = NotificationResult;
/** يُكتب مع FAILED أو EXPIRED أو SUPPRESSED ومسح الوجهة في المعاملة نفسها. */
export type NotificationFailed = NotificationResult;
