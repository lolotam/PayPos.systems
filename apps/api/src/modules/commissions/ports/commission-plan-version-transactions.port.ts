import type { CommissionPlanVersion, CreateCommissionPlanVersionInput } from '@pospay/contracts';

import type { CommissionPlanStatementPeriod } from '../domain/plan-periods.ts';

/** هوية من يُنشئ الإصدار: المستأجر والنشاط والموظفة المستهدفة، لأن الإصدار يخص موظفة داخل نشاط ويقيَّد بصلاحية المستخدم. */
export interface CommissionPlanVersionActor {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly employeeId: string;
}

/** طلب إنشاء إصدار خطة بهوية الفاعل والمفتاح والبصمة، لأن إعادة الإرسال يجب أن تُميَّز بين الطلب نفسه وطلب مختلف يحمل المفتاح نفسه. */
export interface CreateCommissionPlanVersionCommand extends CommissionPlanVersionActor {
  readonly input: CreateCommissionPlanVersionInput;
  readonly key: string;
  readonly fingerprint: string;
}

/** خطوات الكتابة التي تحتاجها حالة استخدام إصدار الخطة داخل معاملة واحدة. */
export interface CommissionPlanVersionScope {
  /**
   * بيقفل صف الموظفة قبل قراءة أعلى رقم إصدار.
   *
   * @returns true عند وجود الموظفة النشطة في النشاط
   */
  lockEmployee(): Promise<boolean>;
  /** بيرجّع توقيت النشاط وتاريخ إنشائه لتحديد اليوم المحلي وأول شهر يسمح به الإصدار. */
  calendar(): Promise<{ readonly timeZone: string; readonly createdAt: Date } | null>;
  /**
   * بيقفل كل الشهور المتأثرة في نداء واحد تصاعدي.
   *
   * @param periods الشهور من شهر السريان حتى الشهر الحالي
   * @returns حالات الكشوف بعد القفل
   */
  lockPeriods(periods: readonly string[]): Promise<CommissionPlanStatementPeriod[]>;
  /**
   * بيرجّع شهور REVIEWED اللاحقة إلى DRAFT ويمسح دليل مراجعتها وفق D-5.
   *
   * @param periods الشهور التي قررت قاعدة FR-007 إرجاعها
   * @returns اكتمال التحديث
   */
  reopenReviewed(periods: readonly string[]): Promise<void>;
  /**
   * بيعيد فحص صلاحية إدارة الخطط وميزة العمولات بعد انتظار أقفال الشهور.
   *
   * @returns FORBIDDEN عند سحب الصلاحية، أو FEATURE_DISABLED عند تعطيل الميزة، أو null عند السماح
   */
  recheckAccess(): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
  /**
   * بيقرأ أعلى رقم إصدار للموظفة بعد قفل صفها.
   *
   * @returns أعلى رقم أو null لأول إصدار
   */
  latestVersion(): Promise<number | null>;
  /**
   * بيدخل الإصدار ويرجع الصف كما خزّنته قاعدة البيانات بشكل العقد.
   *
   * @param record الإصدار كامل المعرف والتوقيت والخطة
   * @returns الصف المخزن
   */
  insert(record: CommissionPlanVersion): Promise<CommissionPlanVersion>;
  /**
   * بيكتب تدقيق إنشاء الإصدار بالخطة فقط، بلا راتب أو بيانات حساسة أخرى.
   *
   * @param record الصف المخزن الذي يوثقه الإدخال
   * @returns اكتمال التدقيق
   */
  audit(record: CommissionPlanVersion): Promise<void>;
}

/** حد المعاملة الذرية وإعادة الإرسال لإنشاء إصدار خطة. */
export interface CommissionPlanVersionTransactions {
  /**
   * ينفذ التحقق والأقفال والكتابة والتدقيق مع مطالبة idempotent في معاملة شركة واحدة.
   *
   * @param command هوية الفاعل والطلب ومفتاح إعادة الإرسال
   * @param work خطوات حالة الاستخدام على المعاملة
   * @returns نتيجة العمل أو جسم الرد المخزن
   */
  run<T>(
    command: CreateCommissionPlanVersionCommand,
    work: (scope: CommissionPlanVersionScope) => Promise<T>,
  ): Promise<T>;
}
