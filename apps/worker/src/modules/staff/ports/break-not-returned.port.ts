import type { BreakNoticeParameter, BreakReturn } from '../domain/break-not-returned.ts';
import type { LeaveInterval } from '../domain/not-clocked-in.ts';
import type { LockedShift, NotClockedInCursor } from './not-clocked-in.port.ts';

/** وردية فيها بريك انتهى ولم يصدر لها إشعار؛ القرار الملزم يعاد تحت قفل State. */
export interface DueBreak {
  readonly id: string;
  readonly employeeId: string;
  readonly startsAt: Date;
}

/** الوردية بعد القفل مع بريكها؛ null في البريك يعني أن المدير شاله. */
export interface LockedBreakShift extends LockedShift {
  readonly breakStartsAt: Date | null;
  readonly breakEndsAt: Date | null;
}

/** نتيجة البريك في دفتر المنع والحدث؛ غياب أو رجوع لفرع آخر، ولا كتابة ثانية لنفس الوردية. */
export interface BreakNoticeWrite {
  readonly kind: 'break_not_returned' | 'break_returned_other_branch';
  readonly returned: BreakReturn | null;
  readonly shift: LockedBreakShift;
  readonly breakEndsAt: Date;
  readonly breakOutAt: Date;
  readonly alertAt: Date;
  readonly detectedAt: Date;
  readonly recipients: readonly string[];
  readonly parameters: readonly BreakNoticeParameter[];
}

/** قراءات وكتابة الوظيفة على معاملة قفل الموظفة. */
export interface LockedBreakNotReturned {
  /**
   * يعيد قراءة الوردية وبريكها الحاليين؛ null إن حُذف الصف عند إعادة حفظ الأسبوع.
   *
   * @param shiftId صف الوردية الذي رأته الصفحة
   * @returns الحقائق الحالية أو null
   */
  shift(shiftId: string): Promise<LockedBreakShift | null>;
  /**
   * إجازات الموظفة المعتمدة التي قد تعذرها عن الرجوع: يومية تغطي يوم العمل أو جزئية تتداخل مع ما بعد البريك.
   *
   * @param employeeId الموظفة
   * @param from نهاية البريك
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
   * آخر خروج بصمته الموظفة بنفسها في نافذة البريك على نفس الوردية ونفس الفرع، لأن التنبيه عن عدم الرجوع بعده.
   *
   * @param shift الوردية وبريكها وفرعها
   * @param from أول لحظة في نافذة الخروج (بداية البريك ناقص المهلة)
   * @returns لحظة الخروج أو null إن لم تبصم خروجاً في النافذة
   */
  breakOut(shift: LockedBreakShift, from: Date): Promise<Date | null>;
  /**
   * أول دخول في أي فرع للنشاط بعد خروج البريك وحتى لحظة القرار، لإسقاط الغياب وتسمية فرع الرجوع.
   *
   * @param shift الوردية ونشاطها
   * @param from خروج البريك
   * @param to لحظة القرار
   * @returns الرجوع وأسماء فرعه أو null إن لم ترجع
   */
  returned(shift: LockedBreakShift, from: Date, to: Date): Promise<BreakReturn | null>;
  /**
   * مستخدمو العضويات النشطة التي تغطي فرع الوردية بالأدوار المعطاة، كما في تنبيه عدم الحضور.
   *
   * @param businessId نشاط الوردية
   * @param branchId فرع الوردية
   * @param roles أدوار القاعدة المؤقتة
   * @returns معرفات المستخدمين بلا تكرار
   */
  managers(
    businessId: string,
    branchId: string,
    roles: readonly string[],
  ): Promise<readonly string[]>;
  /**
   * يدرج نتيجة البريك مرة واحدة مع التدقيق وحدث لكل مجموعة مستلمين لا تتجاوز مئة، في نفس المعاملة.
   *
   * @param notice حقائق التنبيه والمستلمون
   * @returns true لو أُدرج الصف الآن
   */
  record(notice: BreakNoticeWrite): Promise<boolean>;
}

/** حدود شركة واحدة؛ لا قراءة عابرة للشركات. */
export interface BreakNotReturnedTransactions {
  /**
   * صفحة الورديات الجارية التي انتهى بريكها وفيها خروج داخل البريك ولا إشعار سابق، بلا أقفال.
   * الوردية المنتهية لا تُقرأ، فلا يُعاد تقييم يوم فات.
   *
   * @param companyId الشركة المجدولة
   * @param breakEndsAtOrBefore أحدث نهاية بريك مستحقة
   * @param endsAfter الورديات التي تنتهي بعد هذه اللحظة فقط
   * @param breakOutLeadMs كم قبل بداية البريك يُحسب الخروج خروجاً للبريك
   * @param after موضع الصفحة السابقة
   * @param limit حجم الصفحة
   * @returns المرشحون
   */
  candidates(
    companyId: string,
    breakEndsAtOrBefore: Date,
    endsAfter: Date,
    breakOutLeadMs: number,
    after: NotClockedInCursor | null,
    limit: number,
  ): Promise<readonly DueBreak[]>;
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
    work: (tx: LockedBreakNotReturned, at: Date) => Promise<T>,
  ): Promise<T>;
}
