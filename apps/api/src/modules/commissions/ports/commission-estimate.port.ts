import type {
  CommissionPlanVersion,
  CommissionSalary,
  ProjectedCommissionLine,
  ProjectedPackageSale,
  ReceivedCommissionCorrection,
  ServiceCommissionOverride,
} from '@pospay/commissions-engine';
import type { Tx } from '@pospay/db';

/** بند خدمة في شهر الموظفة مع فرع workday ويومه، عشان نسبة الفلترة باليوم تبقى من الأصل. */
export interface CommissionEstimateLine extends ProjectedCommissionLine {
  readonly branchId: string;
  readonly businessDate: string;
}

/** بيع باقة في شهر الموظفة مع فرعه، والحالة المحفوظة بتتحوّل لحالة المحرك في القارئ. */
export interface CommissionEstimateSale extends ProjectedPackageSale {
  readonly branchId: string;
}

/** بقشيش الشهر مع فرعه ويومه؛ البقشيش بيعدّي من غير تسعير (D-1). */
export interface CommissionEstimateTip {
  readonly sessionId: string;
  readonly employeeId: string;
  readonly branchId: string;
  readonly businessDate: string;
  readonly method: 'CARD' | 'CASH';
  readonly amount: bigint;
}

/** تصحيح مستلم في الشهر: نسبته المجمَّدة بتحدد رؤيته (FR-040). */
export interface CommissionEstimateCorrection extends ReceivedCommissionCorrection {
  readonly sourceBranchId: string;
  readonly sourceBusinessDate: string;
  readonly attachedBranchIds: readonly string[];
}

/** موظفة النشاط بأسمائها، من قارئ الموظفين في staff. */
export interface CommissionEstimateEmployee {
  readonly employeeId: string;
  readonly nameAr: string | null;
  readonly nameEn: string;
  readonly employeeNumber: number;
}

/** ارتباط موظفة بفرع بتاريخين: البداية داخلة والنهاية خارجة، والفارغة ارتباط مفتوح. */
export interface CommissionEstimateAttachment {
  readonly employeeId: string;
  readonly branchId: string;
  readonly from: string;
  readonly to: string | null;
}

/** صفوف شهر النشاط كلها، مقروءة مرة واحدة ومجمّعة بالاستعلام. */
export interface CommissionEstimateMonthRows {
  readonly lines: readonly CommissionEstimateLine[];
  readonly sales: readonly CommissionEstimateSale[];
  readonly tips: readonly CommissionEstimateTip[];
  readonly salaries: readonly CommissionSalary[];
  readonly versions: readonly CommissionPlanVersion[];
  readonly overrides: readonly ServiceCommissionOverride[];
  readonly corrections: readonly CommissionEstimateCorrection[];
}

/**
 * النطاق الفعّال للقارئ كما حله قارئ identity: إما النشاط كله أو فروع محددة.
 * `null` معناها رفض موحّد، والميزة المقفولة سبب رفض مستقل.
 */
export type CommissionEstimateScopeResult =
  | { readonly kind: 'scope'; readonly businessWide: boolean; readonly branchIds: readonly string[] }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'feature_disabled' };

/**
 * قراءات تقدير العمولة: كلها قراءات، ومفيش كاتب ولا مولّد هوية ولا قفل (D-25).
 * كل القراءات بتجري في نفس معاملة القراءة، عشان الأرقام تيجي من لقطة واحدة.
 */
export interface CommissionEstimateReads {
  /**
   * بيحل النطاق الفعّال للقارئ على النشاط: الرفض الموحّد والميزة المقفولة سببان منفصلان.
   *
   * @param companyId الشركة المؤكدة
   * @param userId المستخدم البشري الفاعل
   * @param businessId النشاط المطلوب
   * @returns النطاق أو سبب الرفض
   */
  scope(
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<CommissionEstimateScopeResult>;
  /**
   * بيقول هل ميزة العمولات مفعّلة للشركة.
   *
   * @param companyId الشركة المؤكدة
   * @returns هل الميزة مفعّلة
   */
  featureEnabled(companyId: string): Promise<boolean>;
  /**
   * بيرجّع موظفات النشاط بأسمائهن، لأن التقدير بيعرض الاسم (FR-023).
   *
   * @param businessId النشاط المطلوب
   * @returns موظفات النشاط
   */
  employees(businessId: string): Promise<readonly CommissionEstimateEmployee[]>;
  /**
   * بيرجّع ارتباطات الموظفات بالفروع بتاريخها، وهي مفتاح الفلترة باليوم (CS-Q20).
   *
   * @param businessId النشاط المطلوب
   * @param employeeIds الموظفات المطلوب ارتباطاتهن
   * @returns الارتباطات بالتواريخ
   */
  attachments(
    businessId: string,
    employeeIds: readonly string[],
  ): Promise<readonly CommissionEstimateAttachment[]>;
  /**
   * بيرجّع صفوف الشهر كلها مرة واحدة: البنود والبيع والبقشيش والرواتب والإصدارات
   * والتجاوزات والتصحيحات المستلمة.
   *
   * @param businessId النشاط المطلوب
   * @param period الشهر المطلوب بصيغة YYYY-MM
   * @returns صفوف الشهر
   */
  month(businessId: string, period: string): Promise<CommissionEstimateMonthRows>;
}

/**
 * مزودو تقدير العمولة من الوحدات صاحبة البيانات: النطاق الفعّال من identity،
 * والاسم والارتباطات من staff. الجذر بيربطهم، والموديول بياخدهم على معاملته.
 */export interface CommissionEstimateProviders {
  /**
   * بيحل النطاق الفعّال للقارئ على النشاط: الرفض الموحّد والميزة المقفولة سببان منفصلان.
   *
   * @param tx معاملة القراءة الحالية
   * @param companyId الشركة المؤكدة
   * @param userId المستخدم البشري الفاعل
   * @param businessId النشاط المطلوب
   * @returns النطاق أو سبب الرفض
   */
  scope(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<CommissionEstimateScopeResult>;
  /**
   * بيقول هل ميزة العمولات مفعّلة للشركة.
   *
   * @param tx معاملة القراءة الحالية
   * @param companyId الشركة المؤكدة
   * @returns هل الميزة مفعّلة
   */
  featureEnabled(tx: Tx, companyId: string): Promise<boolean>;
  /**
   * بيرجّع موظفات النشاط بأسمائهن، لأن التقدير بيعرض الاسم (FR-023).
   *
   * @param tx معاملة القراءة الحالية
   * @param companyId الشركة المؤكدة
   * @param businessId النشاط المطلوب
   * @returns موظفات النشاط
   */
  employees(
    tx: Tx,
    companyId: string,
    businessId: string,
  ): Promise<readonly CommissionEstimateEmployee[]>;
  /**
   * بيرجّع ارتباطات الموظفات بالفروع بتاريخها، وهي مفتاح الفلترة باليوم (CS-Q20).
   *
   * @param tx معاملة القراءة الحالية
   * @param companyId الشركة المؤكدة
   * @param businessId النشاط المطلوب
   * @param employeeIds الموظفات المطلوب ارتباطاتهن
   * @returns الارتباطات بالتواريخ
   */
  attachments(
    tx: Tx,
    companyId: string,
    businessId: string,
    employeeIds: readonly string[],
  ): Promise<readonly CommissionEstimateAttachment[]>;
}

/** مدخلات التقدير المقروءة كلها من لقطة القراءة الواحدة. */
export interface CommissionEstimateReadResult {
  /** القارئ على مستوى النشاط كله ولا على فروع محددة، ورفض موحّد لما يكون مفيش صلاحية. */
  readonly businessWide: boolean;
  readonly branchIds: readonly string[];
  readonly employees: readonly CommissionEstimateEmployee[];
  readonly attachments: readonly CommissionEstimateAttachment[];
  readonly month: CommissionEstimateMonthRows;
}

/**
 * قارئ التقدير: بيفتح معاملة قراءة فقط ويقرا كل المدخلات في لقطة واحدة
 * (D-25). مفيش كاتب ولا قفل ولا أثر في الداتابيز.
 */
export interface CommissionEstimateReader {
  /**
   * بيفتح المعاملة ويقرا كل ما التقدير محتاجه.
   *
   * @param input طلب القراءة
   * @param input.companyId الشركة المؤكدة
   * @param input.userId المستخدم البشري الفاعل
   * @param input.businessId النشاط المطلوب
   * @param input.period الشهر المطلوب بصيغة YYYY-MM
   * @returns مدخلات التقدير أو سبب الرفض
   */
  read(input: {
    readonly companyId: string;
    readonly userId: string;
    readonly businessId: string;
    readonly period: string;
  }): Promise<
    | { readonly kind: 'ok'; readonly inputs: CommissionEstimateReadResult }
    | { readonly kind: 'forbidden' }
    | { readonly kind: 'feature_disabled' }
  >;
}
