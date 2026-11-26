import type { RatingClaimsTurnSummary } from '../domain/rating-claim-scheduling.ts';

/**
 * تقرير فيضان خريطة الإعادة: العدّاد وأقدم استحقاق وآخر جولة كاملة وعلم المصالحة.
 *
 * التقرير ما فيهوش أي معرّف طلب: الأرقام والوقت بس، عشان يتكتب في السجل من غير
 * ما يسرّب بيانات المستأجر.
 */
export interface RatingClaimsOverflowReport {
  /** عدد مرات الفيضان بالتراكم. */
  readonly overflowCount: number;
  /** أقدم لحظة استحقاق في خريطة الإعادة بالمللي ثانية، أو null لما الخريطة فاضية. */
  readonly oldestRetryEligibleAt: number | null;
  /** لحظة التشخيص بالمللي ثانية. */
  readonly now: number;
  /** معرّف آخر جولة كاملة خلصت بنجاح. */
  readonly lastCompletedSweepId?: string | undefined;
  /** هل في جولة كاملة لازم تعمل مصالحة. */
  readonly reconcileRequired: boolean;
}

/** عملية فقد السور: في نص الدور، أو في إفلات الحالة في آخر الدور. */
export type RatingClaimFenceLostOperation = 'turn' | 'release';

/** رمز الرد اللي بيقول إن السور مش سليم: قديم، مش موجود، تالف، أو مش ours. */
export type RatingClaimFenceLostCode = 'STALE' | 'BUSY' | 'MISSING' | 'CORRUPT';

/** تشخيص مجدول طلبات التقييم: فشل صف، أو فيضان، أو فقد سور، أو ملخص دور. */
export interface RatingClaimDiagnostics {
  /**
   * يسجل نوع الخطأ ورمزه الآمنين فقط؛ الرسالة والهاتف والرابط ومفاتيح Redis لا تُطبع.
   *
   * @param companyId الشركة المالكة للجولة
   * @param error سبب فشل الطلب قبل تنقيحه في المحول
   */
  failed(companyId: string, error: unknown): void;

  /**
   * يسجل فيضان خريطة الإعادة: العدّاد وأقدم استحقاق وآخر جولة كاملة وعلم المصالحة.
   *
   * @param companyId الشركة المالكة للجولة
   * @param report أعداد الفيضان وأوقاته، من غير معرّفات طلبات
   */
  overflow(companyId: string, report: RatingClaimsOverflowReport): void;

  /**
   * يسجل فقد السور: رمز الرد بس، من غير تفاصيل تانية.
   *
   * @param companyId الشركة المالكة للدور
   * @param code رمز الرد اللي فقد السور: STALE أو BUSY أو MISSING أو CORRUPT
   * @param operation العملية اللي فقد السور فيها: في نص الدور، أو في إفلاته
   */
  fenceLost(
    companyId: string,
    code: RatingClaimFenceLostCode,
    operation?: RatingClaimFenceLostOperation,
  ): void;

  /**
   * يسجل ملخص الدور: أعداد التسويات وسبب الانتهاء، من غير أي معرّف.
   *
   * @param companyId الشركة المالكة للدور
   * @param summary ملخص الدور المنقّى
   */
  turnSummary(companyId: string, summary: RatingClaimsTurnSummary): void;
}
