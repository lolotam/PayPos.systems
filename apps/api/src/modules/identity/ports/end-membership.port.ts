import type { GrantInvalidator } from './permission-overrides.port.ts';

/** رفض متوقع في إنهاء العضوية — الـ use case بيحوّله لكود خطأ معروف. */
export type EndMembershipRefusal =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'LAST_OWNER'
  | 'STAFF_ACCESS_MANAGED_MEMBERSHIP';

/** المتصل والعضوية المطلوب إنهاؤها، والشركة مؤكدة من الحارس. */
export interface EndMembershipCommand {
  readonly companyId: string;
  readonly actorUserId: string;
  readonly membershipId: string;
}

/** نتيجة المعاملة: عضوية منتهية (بوقت الإنهاء) أو رفض متوقع. */
export type EndMembershipOutcome =
  | { readonly refusal: EndMembershipRefusal }
  | { readonly id: string; readonly endsAt: string };

/** حدود قاعدة البيانات لإنهاء العضوية، عشان الـ use case يفضل قابل للاختبار من غير Postgres. */
export interface EndMembershipTransactions {
  /**
   * بيعيد فحص سلطة المالك الكانوني جوه المعاملة، ويقفل صف العضوية بس، وينهيها مع تدقيقها،
   * ويحوّل رفض آخر مالك (تريجر 0013 عند الـ commit) لرفض LAST_OWNER بدل 500.
   *
   * @param command الشركة والفاعل والعضوية
   * @param now     وقت الإنهاء من الساعة المحقونة
   */
  end(command: EndMembershipCommand, now: Date): Promise<EndMembershipOutcome>;
}

/** اعتماديات إنهاء العضوية. */
export interface EndMembershipDependencies {
  readonly transactions: EndMembershipTransactions;
  readonly invalidator: GrantInvalidator;
  readonly clock: { now(): Date };
}
