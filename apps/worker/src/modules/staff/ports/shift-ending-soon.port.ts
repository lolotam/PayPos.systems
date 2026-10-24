import type { AlertKind, EffectiveAlertRule } from '@pospay/domain';
import type { LeaveInterval } from '../domain/not-clocked-in.ts';
import type { EndsSoonParameter } from '../domain/shift-ending-soon.ts';
import type { AlertRulesPort } from './alert-rule.port.ts';
import type { LockedShift } from './not-clocked-in.port.ts';

/** موضع الصفحة التالية بترتيب (starts_at ثم employee_id)، لأن صفوف الوردية بتتبدل عند إعادة حفظ الأسبوع (ADR-0024). */
export interface ShiftEndCursor {
  readonly startsAt: Date;
  readonly employeeId: string;
}

/** وردية جارية مرشحة من قراءة بلا قفل ومعها علامة الحضور؛ القرار الملزم يعاد تحت قفل State. */
export interface DueShiftEnd {
  readonly id: string;
  readonly employeeId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly businessId: string;
  readonly branchId: string;
  readonly hasOpenSession: boolean;
}

/** حقائق التذكير اللي بتتكتب في دفتر «دوامك قرب يخلص» مع حدث الإشعار. */
export interface ShiftEndNoticeWrite {
  readonly shift: LockedShift;
  readonly remindAt: Date;
  readonly detectedAt: Date;
  readonly userId: string | null;
  readonly parameters: readonly EndsSoonParameter[];
}

/** سطر الدفتر اللي بيتكتب والقاعدة مقفولة: سطر دفتر بلا إشعار (spec 060 D-B15). */
export interface ShiftEndSuppressedWrite {
  readonly shift: LockedShift;
  readonly remindAt: Date;
  readonly detectedAt: Date;
}

/** قراءات وكتابة الوظيفة على معاملة قفل الموظفة. */
export interface LockedShiftEnding {
  /** القاعدة الفعلية لنوع التنبيه، تُقرأ على نفس معاملة القفل. */
  readonly rules: AlertRulesPort;
  /**
   * يعيد قراءة الوردية الحالية؛ null إن حُذف الصف عند إعادة حفظ الأسبوع.
   *
   * @param shiftId صف الوردية الذي رأته الصفحة
   * @returns الحقائق الحالية أو null
   */
  shift(shiftId: string): Promise<LockedShift | null>;
  /**
   * إجازات الموظفة المعتمدة التي قد تعذرها عن التذكير: يومية تغطي يوم العمل أو جزئية توصل لنهاية الوردية.
   *
   * @param employeeId الموظفة
   * @param from بداية الوردية
   * @param to نهاية الوردية
   * @param workingDate يوم بداية الوردية
   * @returns الإجازات المعتمدة فقط
   */
  approvedLeaves(
    employeeId: string,
    from: Date,
    to: Date,
    workingDate: string,
  ): Promise<readonly LeaveInterval[]>;
  /**
   * هل عند الموظفة بصمة مفتوحة الآن في أي فرع؟ التذكير لللي شغالة فعلاً.
   *
   * @param employeeId الموظفة
   * @returns true لو في جلسة مفتوحة غير ملغاة
   */
  hasOpenSession(employeeId: string): Promise<boolean>;
  /**
   * هل للمستخدم المرتبط عضوية سارية تغطّي الشركة أو نشاط الموظفة أو فرع من فروعها في يوم الوردية؟
   * عضوية منتهية أو مغطّاش النطاق معناها إن صلاحيته في الشغل انتهت (ADR-0052 §5).
   *
   * @param userId المستخدم
   * @param shift الوردية المقفولة: نشاط الموظفة وفروعها
   * @param at لحظة القرار
   * @returns true لو العضوية سارية وتغطّي النطاق
   */
  userHasAccess(userId: string, shift: LockedShift, at: Date): Promise<boolean>;
  /**
   * يدرج سطر الدفتر مرة واحدة مع التدقيق وحدث الإشعار، في نفس المعاملة.
   *
   * @param notice حقائق التذكير والمستقبل
   * @returns true لو أُدرج الصف الآن
   */
  record(notice: ShiftEndNoticeWrite): Promise<boolean>;
  /**
   * يدرج سطر دفتر واحد مكبوح: بلا تدقيق وبلا حدث وبلا مستلمين.
   *
   * @param write لحظات الاستحقاق والكشف
   * @returns true لو أُدرج الصف الآن
   */
  suppress(write: ShiftEndSuppressedWrite): Promise<boolean>;
}

/** حدود شركة واحدة؛ لا قراءة عابرة للشركات. */
export interface ShiftEndingSoonTransactions {
  /**
   * القاعدة الفعلية لنوع التنبيه بلا قفل؛ دي كاش للترشيح فقط والقرار بيقراها تاني تحت القفل.
   *
   * @param companyId الشركة المجدولة
   * @param scope نشاط الوردية وفرعها
   * @param scope.businessId نشاط الوردية
   * @param scope.branchId فرع الوردية
   * @param kind نوع التنبيه
   * @returns القاعدة الفعلية
   */
  rule(
    companyId: string,
    scope: { businessId: string; branchId: string },
    kind: AlertKind,
  ): Promise<EffectiveAlertRule>;
  /**
   * صفحة الورديات الجارية بلا سطر دفتر سابق، ومعها علامة الحضور في نفس القراءة، بلا أقفال.
   *
   * @param companyId الشركة المجدولة
   * @param now لحظة الدورة
   * @param after موضع الصفحة السابقة
   * @param limit حجم الصفحة
   * @returns المرشحون
   */
  candidates(
    companyId: string,
    now: Date,
    after: ShiftEndCursor | null,
    limit: number,
  ): Promise<readonly DueShiftEnd[]>;
  /**
   * يقفل State الموظفة أولاً، ثم يأخذ الساعة مرة واحدة، ثم ينفذ القرار.
   *
   * @param companyId الشركة المجدولة
   * @param employeeId الموظفة المرشحة
   * @param sample أخذ لحظة القرار بعد القفل
   * @param work القرار والكتابة تحت القفل
   * @returns نتيجة العمل بعد commit
   */
  run<T>(
    companyId: string,
    employeeId: string,
    sample: () => Date,
    work: (tx: LockedShiftEnding, at: Date) => Promise<T>,
  ): Promise<T>;
}
