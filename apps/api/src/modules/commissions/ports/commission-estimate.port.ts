import type {
  CommissionEstimateAttachment,
  CommissionEstimateMonthRows,
} from '@pospay/commissions-engine';

/**
 * موظفة النشاط بأسمائها، من قارئ الموظفين في staff. الاسم من مالك القراءة (D-16)
 * ومن غير صف موظفين ما بتعرضش موظفة من نشاط تاني.
 */
export interface CommissionEstimateEmployeeName {
  readonly employeeId: string;
  readonly nameAr: string | null;
  readonly nameEn: string;
  readonly employeeNumber: number;
}

/**
 * النطاق الفعّال للقارئ كما حله قارئ identity: إما النشاط كله أو فروع محددة.
 * `null` معناها رفض موحّد، والميزة المقفولة سبب رفض مستقل.
 */
export type CommissionEstimateScopeResult =
  | {
      readonly kind: 'scope';
      readonly businessWide: boolean;
      readonly branchIds: readonly string[];
    }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'feature_disabled' };

/** مدخلات التقدير المقروءة كلها من لقطة القراءة الواحدة. */
export interface CommissionEstimateReadResult {
  /** القارئ على مستوى النشاط كله ولا على فروع محددة، ورفض موحّد لما يكون مفيش صلاحية. */
  readonly businessWide: boolean;
  readonly branchIds: readonly string[];
  readonly employees: readonly CommissionEstimateEmployeeName[];
  readonly attachments: readonly CommissionEstimateAttachment[];
  readonly month: CommissionEstimateMonthRows;
  /** أسماء الخدمات، وقت ما تكون موجودة في الكتالوج. */
  readonly serviceNames: ReadonlyMap<string, { readonly nameEn: string; readonly nameAr: string | null }>;
}

/**
 * قارئ التقدير: بيفتح معاملة قراءة فقط ويقرا كل المدخلات في لقطة واحدة
 * (D-25). مفيش كاتب ولا قفل ولا أثر في الداتابيز. البورت مش بيعرف الداتابيز:
 * المعاملة كلها جوّه المحوّل (persistence).
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
   * @param input.employeeId الموظفة المطلوبة اختيارياً؛ من غيرها كل موظفات النشاط
   * @returns مدخلات التقدير أو سبب الرفض
   */
  read(input: {
    readonly companyId: string;
    readonly userId: string;
    readonly businessId: string;
    readonly period: string;
    readonly employeeId: string | null;
  }): Promise<
    | { readonly kind: 'ok'; readonly inputs: CommissionEstimateReadResult }
    | { readonly kind: 'forbidden' }
    | { readonly kind: 'feature_disabled' }
  >;
}
