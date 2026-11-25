import type {
  CommissionCorrectionBlockedNoticeRequested as CommissionCorrectionBlockedNoticeRequestedEvent,
  CommissionEventParkedNoticeRequested as CommissionEventParkedNoticeRequestedEvent,
} from '@pospay/contracts';

/** يُكتب عند تسجيل تصحيح عمولة موقوف لأول مرة: مجموعة مستلمين واحدة لكل حدث (مئة على الأكثر)، في معاملة تسجيل التوقف نفسها. */
export type CommissionCorrectionBlockedNoticeRequested =
  CommissionCorrectionBlockedNoticeRequestedEvent;

/** يُكتب بعد ثبوت إيقاف حدث عمولة في الـoutbox: مجموعة مستلمين واحدة لكل حدث (مئة على الأكثر)، في معاملة التنبيه نفسها. */
export type CommissionEventParkedNoticeRequested =
  CommissionEventParkedNoticeRequestedEvent;
