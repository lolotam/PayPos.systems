import type { CommissionCorrectionBlockedNoticeRequested as CommissionCorrectionBlockedNoticeRequestedEvent } from '@pospay/contracts';

/** يُكتب عند تسجيل تصحيح عمولة موقوف لأول مرة: مجموعة مستلمين واحدة لكل حدث (مئة على الأكثر)، في معاملة تسجيل التوقف نفسها. */
export type CommissionCorrectionBlockedNoticeRequested =
  CommissionCorrectionBlockedNoticeRequestedEvent;
