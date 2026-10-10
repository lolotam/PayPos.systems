import type {
  ConcreteShift,
  ScheduleRecord,
  SchedulingEmployee,
  TemplateRecord,
  WeeklyShift,
} from '../domain/schedule-types.ts';

/** هوية الفاعل والشركة المختارة دون أي صلاحية يرسلها العميل. */
export interface ScheduleActor {
  companyId: string;
  userId: string;
}
/** مصدر الوقت المحقون لإثبات متطلبات التعديل الماضي. */
export interface ScheduleClock {
  /** وقت محقون يجعل تحديد الأيام الماضية قابلاً للاختبار دون ساعة الخادم. */
  now(): Date;
}
/** مولد المعرفات المحقون لنسخ الأسابيع والقوالب. */
export interface ScheduleIds {
  /** معرف UUID v7 محقون يمنع اعتماد التنسيق على مولد عشوائي. */
  newId(): string;
}
/** عمليات التحقق والقراءة والكتابة ضمن معاملة واحدة للشركة. */
export interface ScheduleScope {
  /**
   * يعيد حد النشاط بعد قفل الكتابة لتطبيق القرار الأحدث على الحفظ.
   *
   * @param businessId النشاط المتحقق منه
   */
  maxShiftsPerDay(businessId: string): Promise<number>;
  /**
   * يحل الفرع الحقيقي ويثبت صلاحية الإدارة والميزة قبل كشف الموظفين.
   *
   * @param businessId النشاط المتحقق منه
   * @param branchId الفرع الحقيقي
   */
  branch(businessId: string, branchId: string): Promise<{ timezone: string }>;
  /**
   * يثبت قراءة أو إدارة قوالب النشاط؛ صلاحية الفرع وحدها لا تكفي.
   *
   * @param businessId النشاط المتحقق منه
   * @param action نوع الإذن المطلوب
   */
  business(businessId: string, action: 'read' | 'manage'): Promise<void>;
  /**
   * يقفل الموظف ويعيد تاريخه والأسبوع وكل وردياته الأخرى لمنع التداخل.
   *
   * @param businessId النشاط المتحقق منه
   * @param branchId الفرع الحقيقي
   * @param employeeId الموظف المطلوب
   * @param weekStart بداية الأسبوع
   */
  employeeWeek(
    businessId: string,
    branchId: string,
    employeeId: string,
    weekStart: string,
  ): Promise<{
    employee: SchedulingEmployee;
    before: ScheduleRecord | null;
    others: (ConcreteShift & { branch_id: string; week_start: string })[];
  }>;
  /**
   * يقرأ أهداف التطبيق دفعة واحدة بعد قفل الموظفين بالترتيب؛ بلا استعلام لكل أسبوع.
   *
   * @param businessId النشاط المتحقق منه
   * @param branchId الفرع الحقيقي
   * @param employeeIds الموظفون المختارون
   * @param weeks الأسابيع المختارة
   * @returns كل هدف مع تاريخ الموظف ووردياته المقارنة
   */
  employeeWeeks(
    businessId: string,
    branchId: string,
    employeeIds: readonly string[],
    weeks: readonly string[],
  ): Promise<ScheduleTarget[]>;
  /**
   * يحفظ نسخة الأسبوع ووردياته والتدقيق في نفس المعاملة.
   *
   * @param before الحالة قبل الكتابة
   * @param after الحالة بعد التحقق
   * @param reason سبب التعديل
   */
  saveWeek(before: ScheduleRecord | null, after: ScheduleRecord, reason?: string): Promise<void>;
  /**
   * يستبدل ورديات كل الأهداف قبل إدخال النسخ لمنع تعارض مرحلي مع نسخة ستستبدلها نفس المعاملة.
   *
   * @param plans كل النسخ المستهدفة
   * @param reason السبب المدخل
   */
  saveWeeks(
    plans: readonly { before: ScheduleRecord | null; after: ScheduleRecord }[],
    reason?: string,
  ): Promise<void>;
  /**
   * يقفل قالب النشاط ويحمي من استخدام معرف نشاط أو شركة أخرى.
   *
   * @param businessId النشاط المتحقق منه
   * @param templateId القالب المطلوب
   */
  template(businessId: string, templateId: string): Promise<TemplateRecord>;
  /**
   * يحفظ إنشاء أو تعديل أو أرشفة القالب والتدقيق معاً.
   *
   * @param before الحالة السابقة
   * @param after الحالة المعتمدة
   */
  saveTemplate(before: TemplateRecord | null, after: TemplateRecord): Promise<void>;
}
/** حد المعاملة الذي يحتفظ بالأقفال حتى اكتمال السجل والتدقيق. */
export interface ScheduleTransactions {
  /**
   * معاملة الشركة تحافظ على أقفال الإذن والموظف حتى اكتمال التدقيق أو rollback.
   *
   * @param actor الفاعل والشركة المتحقق منهما
   * @param work تنسيق المعاملة
   */
  run<T>(actor: ScheduleActor, work: (scope: ScheduleScope) => Promise<T>): Promise<T>;
}
/** مدخل إنشاء أو تحديث نمط القالب دون حقول تخزين. */
export interface TemplateCommand {
  name_en: string;
  name_ar?: string | null;
  shifts: WeeklyShift[];
}
/** هدف نسخة واحدة داخل تطبيق قالب ذري. */
export interface ScheduleTarget {
  employee: SchedulingEmployee;
  before: ScheduleRecord | null;
  others: (ConcreteShift & { branch_id: string; week_start: string })[];
  weekStart: string;
}
