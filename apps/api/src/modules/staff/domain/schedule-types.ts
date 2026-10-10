/** نمط وردية محلية ببريك اختياري محسوب كعمل؛ اليوم صفر للسبت والوردية تنسب ليوم بدايتها. */
export interface WeeklyShift {
  day: number;
  start: string;
  end: string;
  break_start: string | null;
  break_end: string | null;
}
/** مدخل قديم أو جديد؛ مفاتيح البريك الغائبة تتحول إلى null عند تثبيت النمط. */
export type WeeklyShiftInput = Omit<WeeklyShift, 'break_start' | 'break_end'> & {
  break_start?: string | null | undefined;
  break_end?: string | null | undefined;
};
/** نسخة فعلية تحفظ يوم العمل ولحظات الوردية والبريك دون تقليل وقت العمل. */
export interface ConcreteShift extends WeeklyShift {
  working_date: string;
  starts_at: string;
  ends_at: string;
  break_starts_at: string | null;
  break_ends_at: string | null;
}
/** أسبوع موظف في فرع محدد مع نسخة تفاؤلية والمنطقة المستخدمة. */
export interface ScheduleRecord {
  id: string;
  business_id: string;
  branch_id: string;
  employee_id: string;
  week_start: string;
  timezone: string;
  revision: number;
  shifts: ConcreteShift[];
}
/** قالب نشاط مستقل؛ تعديل النمط لا يغير النسخ المطبقة. */
export interface TemplateRecord {
  id: string;
  business_id: string;
  name_en: string;
  name_ar: string | null;
  shifts: WeeklyShift[];
  revision: number;
  archived_at: string | null;
}
/** أهلية الموظف بالتواريخ وارتباطات الفروع التاريخية دون بيانات مالية. */
export interface SchedulingEmployee {
  id: string;
  business_id: string;
  hire_date: string;
  contract_end: string | null;
  deleted_at: string | null;
  attachments: { branch_id: string; from: string; to: string | null }[];
}
/** أسباب الرفض المسماة التي يترجمها محول HTTP. */
export type ScheduleErrorCode =
  | 'SCHEDULE_WEEK_INVALID'
  | 'SCHEDULE_SHIFT_INVALID'
  | 'SCHEDULE_DAY_LIMIT_EXCEEDED'
  | 'SCHEDULE_BREAK_INVALID'
  | 'VALIDATION_FAILED'
  | 'SCHEDULE_SHIFT_OVERLAP'
  | 'SCHEDULE_LOCAL_TIME_INVALID'
  | 'SCHEDULE_EMPLOYEE_INELIGIBLE'
  | 'SCHEDULE_PAST_REASON_REQUIRED'
  | 'SCHEDULE_REVISION_CONFLICT'
  | 'SCHEDULE_APPLY_CONFLICT'
  | 'SCHEDULE_APPLY_BATCH_TOO_LARGE'
  | 'SCHEDULE_REPLACE_REASON_REQUIRED'
  | 'SCHEDULE_TEMPLATE_ARCHIVED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'FEATURE_DISABLED'
  | 'TRANSACTION_RETRY_REQUIRED';
/** خطأ مجال مسمى يمنع تسرب تفاصيل قاعدة البيانات ويترك ترجمة HTTP للمحول. */
export class ScheduleError extends Error {
  /**
   * ينشئ رفضاً مسمى يمكن تحويله إلى رسالة ثنائية اللغة دون كشف بيانات أجنبية.
   *
   * @param code سبب الرفض
   * @param details تفاصيل الأهداف المصرح بها فقط
   */
  constructor(
    readonly code: ScheduleErrorCode,
    readonly details?: unknown,
  ) {
    super(code);
  }
}
