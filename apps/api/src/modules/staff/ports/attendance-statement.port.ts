import type { DocumentRenderState } from '@pospay/contracts';
import type { ReportBranchInputs } from '@pospay/domain';

import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';

/** فترة محلية شاملة للطرفين؛ قواعد التغطية بتفسرها بتوقيت الفرع. */
export interface StatementPeriod {
  from: string;
  to: string;
}

/** ربط المستند بالمستأجر وصاحب الطلب ومساره لمنع استلامه من نطاق آخر. */
export interface StatementScope {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string;
}

/** بيانات النقل بعد حفظ الطلب؛ محتوى الموظفات لا يخرج إلى الطابور. */
export interface StatementRenderJob {
  companyId: string;
  renderId: string;
  kind: string;
  requestedBy: string;
  filename: string;
}

/** معلمات الطلب الثابتة التي يعيد العامل قراءة بياناتها الحالية وقت التجهيز. */
export interface StatementRequestRow {
  id: string;
  companyId: string;
  businessId: string;
  branchId: string;
  form: 'BRANCH' | 'EMPLOYEE';
  employeeId: string | null;
  from: string;
  to: string;
  language: 'ar' | 'en';
  shift: { start: string; end: string } | null;
  logoFileId: string | null;
  requestedBy: string;
  requestedAt: Date;
}

/** قرار الشعار يُثبت مع الطلب حتى لا تغيّر إعادة المحاولة المستند الرسمي. */
export interface StatementLogoReferenceReader {
  /**
   * يعيد معرف الشعار المربوط بالنشاط وقت الطلب، أو null عندما لا يوجد شعار مربوط.
   *
   * @param businessId النشاط صاحب الهوية المطلوبة
   * @returns معرف ملف الشعار المخزن أو null
   */
  read(businessId: string): Promise<string | null>;
}

/** حدود معاملة الطلب؛ قراءة التغطية والشعار والحفظ تشترك في الاتصال نفسه. */
export interface StatementRequestContext {
  /**
   * يؤكد أن فرع المسار تابع للنشاط ويعيد منطقته الفعالة قبل قبول الفترة.
   *
   * @returns الفرع ومنطقته، أو null عند اختلاف النطاق
   */
  branch(): Promise<{ id: string; timezone: string } | null>;
  /**
   * يجمع مدخلات موظفة واحدة من التقرير والجدول لاختبار تغطيتها في الفترة نفسها.
   *
   * @param employeeId الموظفة المطلوبة
   * @param period أول وآخر يوم عمل في الطلب
   * @returns مدخلات الفرع، أو null عندما لا توجد الموظفة أو مدخلاتها
   */
  employeeInputs(employeeId: string, period: StatementPeriod): Promise<ReportBranchInputs | null>;
  readonly logo: StatementLogoReferenceReader;
  /**
   * يسجل معلمات الطلب ولحظته وقرار شعاره قبل إرساله للتجهيز.
   *
   * @param row صف الطلب الكامل دون بيانات محسوبة
   * @returns اكتمال حفظ الصف في معاملة الطلب
   */
  insert(row: StatementRequestRow): Promise<void>;
}

/** كل قراءات وكتابة الطلب تشترك في معاملة مستأجر واحدة حتى لا يتسرب سياق التخزين للاستخدام. */
export interface AttendanceStatementTransactions {
  /**
   * يفتح معاملة المستأجر والمستخدم ويمرر سياقاً محدوداً لعملية الطلب.
   *
   * @param scope الشركة والمستخدم والنشاط والفرع من المسار
   * @param work عملية الطلب داخل المعاملة
   * @returns نتيجة العملية بعد نجاح المعاملة
   */
  run<T>(scope: StatementScope, work: (context: StatementRequestContext) => Promise<T>): Promise<T>;
}

/** نقل المستند للعامل الخارجي دون كشف Redis أو الطابور لقواعد الطلب. */
export interface DocumentRenderTransport {
  /**
   * يفحص نبض العامل قبل استهلاك حد المستخدم أو تسجيل طلب جديد.
   *
   * @returns true عندما يستطيع العامل قبول مستند PDF
   */
  rendererAlive(): Promise<boolean>;
  /**
   * ينشر حالة الانتظار ثم يضع معرفات المستند في طابور العامل.
   *
   * @param job الشركة والمستند والنوع وصاحب الطلب واسم الملف
   * @returns اكتمال نشر الحالة وإضافة المهمة
   */
  queue(job: StatementRenderJob): Promise<void>;
  /**
   * يسجل فشل النقل كحالة ظاهرة للمستخدم بعد بقاء صف الطلب محفوظاً.
   *
   * @param companyId شركة المستند
   * @param renderId معرف المستند
   * @returns اكتمال تسجيل الفشل على أساس أفضل جهد
   */
  markFailed(companyId: string, renderId: string): Promise<void>;
}

/** حقائق حالة المستند في Redis: الحالة وصاحب الطلب ونوع الملف. */
export interface DocumentStatusFacts {
  state: DocumentRenderState;
  requestedBy: string;
  mimeType: string | null;
}

/** سياق التحميل: صف الطلب المربوط وسجل التنزيل. */
export interface StatementCollectContext {
  /**
   * يقرأ صف الطلب المربوط بالشركة والنشاط والفرع وصاحب الطلب.
   *
   * @param renderId معرف المستند المطلوب تحميله
   * @returns صف الطلب، أو null لما الطلب مش موجود أو لمستخدم تاني
   */
  binding(renderId: string): Promise<StatementRequestRow | null>;
  readonly audit: AuditTrail;
}

/** التحميل يقرأ صف الطلب ويسجل التنزيل في نفس المعاملة، عشان مفيش تنزيل بلا أثر. */
export interface StatementCollectTransactions {
  /**
   * يفتح معاملة المستأجر والمستخدم ويسلّم سياق التحميل.
   *
   * @param scope الشركة والمستخدم والنشاط والفرع من المسار
   * @param work عملية التحميل داخل المعاملة
   * @returns نتيجة العملية بعد نجاح المعاملة
   */
  run<T>(scope: StatementScope, work: (context: StatementCollectContext) => Promise<T>): Promise<T>;
}

/** بايتات المستند وحالته في Redis؛ النقل مؤقت وكل تحميل بيستلم الملف مرة واحدة. */
export interface DocumentBytesStore {
  /**
   * يقرأ حالة المستند وصاحب الطلب ونوع الملف من هاش الحالة.
   *
   * @param companyId شركة المستند
   * @param renderId معرف المستند
   * @returns حقائق الحالة، أو null لما الهاش معدش موجود أو حالته مش معروفة
   */
  status(companyId: string, renderId: string): Promise<DocumentStatusFacts | null>;
  /**
   * ياخد بايتات المستند ويحيّدها في عملية واحدة، عشان ملف واحد يوصل لمستخدم واحد بس.
   *
   * @param companyId شركة المستند
   * @param renderId معرف المستند
   * @returns بايتات المستند، أو null لما البايتات راحت
   */
  take(companyId: string, renderId: string): Promise<Uint8Array | null>;
  /**
   * يسجّل إن المستند اتسلّم؛ الحالة ما بتتحركش من READY غير، ومهلة الهاش بتفضل زي ما هي.
   *
   * @param companyId شركة المستند
   * @param renderId معرف المستند
   * @returns اكتمال تسجيل التسليم
   */
  markConsumed(companyId: string, renderId: string): Promise<void>;
}
