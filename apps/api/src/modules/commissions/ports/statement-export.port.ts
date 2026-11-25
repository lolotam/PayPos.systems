import type { DocumentRenderState } from '@pospay/contracts';

import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import type {
  FrozenEmployeeBranches,
  StatementExportReaderScope,
  StatementExportScope,
} from '../domain/statement-export-scope.ts';

/** نتيجة حل نطاق القارئ جوه معاملة الطلب أو التحميل: نطاق فعّال، أو رفض موحّد، أو ميزة مقفولة. */
export type StatementExportReaderResult =
  | ({ readonly kind: 'scope' } & StatementExportReaderScope)
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'feature_disabled' };

/** كشف الشهر كما يراه الطلب: معرّفه وحالته. */
export interface ExportableStatement {
  readonly id: string;
  readonly status: string;
}

/** صف طلب التصدير اللي بيتكتب قبل الإرسال للعامل (FR-050). */
export interface StatementExportRow {
  readonly id: string;
  readonly renderId: string;
  readonly businessId: string;
  readonly statementId: string;
  readonly period: string;
  readonly requestedBy: string;
  readonly requestedMembershipId: string;
  readonly scope: StatementExportScope;
  readonly language: 'ar' | 'en';
  readonly requestedAt: Date;
}

/** صف الطلب كما يقرؤه التحميل: النطاق المحفوظ ووقت التحميل لو حصل. */
export interface StatementExportBinding {
  readonly id: string;
  readonly statementId: string;
  readonly period: string;
  readonly businessId: string;
  readonly language: 'ar' | 'en';
  readonly scope: StatementExportScope;
  readonly collectedAt: Date | null;
}

/** سياق معاملة الطلب: كل القراءات والكتابة بتشترك في اتصال واحد. */
export interface StatementExportRequestContext {
  /**
   * يحل النطاق الفعّال للطالب على النشاط ويتأكد من الميزة، جوه معاملة الطلب نفسها (CS-Q20).
   *
   * @returns النطاق أو سبب الرفض الموحّد
   */
  reader(): Promise<StatementExportReaderResult>;
  /**
   * يقرأ كشف الشهر المطلوب من غير قفل؛ الكشف المعتمد ما بيرجعش لحالة أقدم.
   *
   * @param period الشهر بصيغة YYYY-MM
   * @returns الكشف، أو null لو الشهر مالوش كشف
   */
  statement(period: string): Promise<ExportableStatement | null>;
  /**
   * يقرأ صفوف `EMPLOYEE` المجمّدة في الكشف بفروعها المجمّدة؛ ده مصدر مجموعة الموظفات (FR-050).
   *
   * @param statementId الكشف المعتمد
   * @returns الموظفات وفروعهن المجمّدة
   */
  frozenEmployees(statementId: string): Promise<readonly FrozenEmployeeBranches[]>;
  /**
   * يرجّع عضوية الطالب اللي اتصرّف من خلالها، عشان صف الطلب يتربط بيها (FR-050).
   *
   * @returns معرّف العضوية، أو null لو مفيش عضوية سارية
   */
  requesterMembership(): Promise<string | null>;
  /**
   * يسجل صف الطلب بنطاقه ولغته قبل إرساله للعامل.
   *
   * @param row الصف الكامل
   * @returns اكتمال الحفظ في معاملة الطلب
   */
  insert(row: StatementExportRow): Promise<void>;
}

/** سياق معاملة التحميل: صف الطلب المقفول، وإعادة فحص الصلاحية، والتسجيل. */
export interface StatementExportCollectContext {
  /**
   * يقفل صف الطلب بتاع الطالب نفسه للشهر ده، عشان التحميل مرة واحدة حتى مع طلبين متزامنين.
   *
   * @param renderId معرّف المستند
   * @param period الشهر في المسار
   * @returns صف الطلب، أو null لما مش موجود أو لمستخدم أو نشاط أو شهر تاني
   */
  binding(renderId: string, period: string): Promise<StatementExportBinding | null>;
  /**
   * يعيد حل النطاق الفعّال للطالب دلوقتي بنفس القواعد (FR-050).
   *
   * @returns النطاق الحالي أو سبب الرفض
   */
  reader(): Promise<StatementExportReaderResult>;
  /**
   * يقرأ صفوف `EMPLOYEE` المجمّدة في الكشف لإعادة فحص الموظفات المحفوظة.
   *
   * @param statementId الكشف المعتمد
   * @returns الموظفات وفروعهن المجمّدة
   */
  frozenEmployees(statementId: string): Promise<readonly FrozenEmployeeBranches[]>;
  /**
   * يثبّت وقت التحميل مرة واحدة على صف الطلب.
   *
   * @param exportId صف الطلب
   * @param at لحظة التحميل
   * @returns اكتمال الكتابة
   */
  markCollected(exportId: string, at: Date): Promise<void>;
  readonly audit: AuditTrail;
}

/** حدود المعاملات: كل واحدة بتفتح معاملة المستأجر والمستخدم وبتسلّم سياقها. */
export interface StatementExportTransactions {
  /**
   * معاملة الطلب.
   *
   * @param scope الشركة والمستخدم والنشاط من المسار والجلسة
   * @param work عملية الطلب داخل المعاملة
   * @returns نتيجة العملية بعد نجاح المعاملة
   */
  request<T>(
    scope: StatementExportScopeIds,
    work: (context: StatementExportRequestContext) => Promise<T>,
  ): Promise<T>;
  /**
   * معاملة التحميل.
   *
   * @param scope الشركة والمستخدم والنشاط من المسار والجلسة
   * @param work عملية التحميل داخل المعاملة
   * @returns نتيجة العملية بعد نجاح المعاملة
   */
  collect<T>(
    scope: StatementExportScopeIds,
    work: (context: StatementExportCollectContext) => Promise<T>,
  ): Promise<T>;
}

/** هوية الطلب: الشركة والمستخدم والنشاط. */
export interface StatementExportScopeIds {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
}

/** بيانات المهمة بعد حفظ الطلب؛ محتوى الكشف مش بيخرج للطابور. */
export interface StatementExportJob {
  readonly companyId: string;
  readonly renderId: string;
  readonly kind: string;
  readonly requestedBy: string;
  readonly filename: string;
}

/** نقل المستند للعامل؛ الطابور وRedis مخفيين عن قواعد الطلب. */
export interface StatementExportTransport {
  /**
   * يفحص نبض عامل الـ PDF؛ مش مطلوب لنوع bytes زي ده، وبيتنادى بس لو النوع محتاج رندرر.
   *
   * @returns true لو العامل شغال
   */
  rendererAlive(): Promise<boolean>;
  /**
   * ينشر حالة الانتظار ويضيف المهمة للطابور.
   *
   * @param job الشركة والمستند والنوع وصاحب الطلب واسم الملف
   * @returns اكتمال النشر والإضافة
   */
  queue(job: StatementExportJob): Promise<void>;
  /**
   * يسجل فشل النقل كحالة ظاهرة بعد بقاء صف الطلب محفوظاً.
   *
   * @param companyId شركة المستند
   * @param renderId معرّف المستند
   * @returns true لو النقل فشل فعلاً، false لو المهمة اتقبلت أو العامل بدأ فيها
   */
  markFailed(companyId: string, renderId: string): Promise<boolean>;
}

/** حالة المستند في Redis كما يحتاجها التحميل: الحالة وصاحب الطلب ونوع الملف. */
export interface StatementExportDocumentFacts {
  readonly state: DocumentRenderState;
  readonly requestedBy: string;
  readonly mimeType: string | null;
}

/** بايتات المستند وحالته؛ النقل مؤقت وكل تحميل بياخد الملف مرة واحدة. */
export interface StatementExportDocumentStore {
  /**
   * يقرأ حالة المستند وصاحب الطلب ونوع الملف.
   *
   * @param companyId شركة المستند
   * @param renderId معرّف المستند
   * @returns حقائق الحالة، أو null لما الهاش مش موجود
   */
  status(companyId: string, renderId: string): Promise<StatementExportDocumentFacts | null>;
  /**
   * ياخد بايتات المستند ويحيّدها في عملية واحدة.
   *
   * @param companyId شركة المستند
   * @param renderId معرّف المستند
   * @returns البايتات، أو null لما راحت
   */
  take(companyId: string, renderId: string): Promise<Uint8Array | null>;
  /**
   * يسجّل إن المستند اتسلّم.
   *
   * @param companyId شركة المستند
   * @param renderId معرّف المستند
   * @returns اكتمال التسجيل
   */
  markConsumed(companyId: string, renderId: string): Promise<void>;
}
