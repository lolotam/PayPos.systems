import type { Tx } from '@pospay/db';

/** معاملة شركة واحدة تعمل فيها تهيئة البقشيش؛ الـ use case ياخدها من المنفذ فما يستوردش @pospay/db. */
export type TipsBootstrapTx = Tx;

/** مشغّل معاملة الشركة: يفتح معاملة الشركة ويسلّمها للـ use case؛ نوعه في المنفذ عشان يبقى الـ use case محرّداً من @pospay/db. */
export type TipsBootstrapTenantRunner = <T>(
  companyId: string,
  fn: (tx: TipsBootstrapTx) => Promise<T>,
) => Promise<T>;

/** جلسة بحالة بقشيشها الحالية: هويتها ومراجعتها ومجموعتها الكاملة وأحداث مراجعاتها. */
export interface BootstrapTipSession {
  readonly sessionId: string;
  readonly businessDate: string;
  readonly branchId: string;
  readonly revision: number;
  readonly tips: {
    readonly employeeId: string;
    readonly method: 'CASH' | 'CARD';
    readonly amount: string;
  }[];
  readonly eventIds: string[];
}

/** صفحة من جلسات البقشيش مع مؤشر الصفحة التالية. */
export interface BootstrapTipPage {
  readonly items: BootstrapTipSession[];
  readonly nextCursor: { readonly businessDate: string; readonly sessionId: string } | null;
}

/** نطاق يومي العمل الذي تقرأ منه تهيئة البقشيش الزيارات. */
export interface BootstrapTipRange {
  readonly from: string;
  readonly to: string;
}

/** مؤشر آخر زيارة في الصفحة السابقة وعدد الزيارات المطلوبة. */
export interface BootstrapTipPageRequest {
  readonly after: { readonly businessDate: string; readonly sessionId: string } | null;
  readonly limit: number;
}

export interface CurrentTipSessionsReader {
  /**
   * يقرأ صفحة من الزيارات التي لها بقشيش؛ التهيئة تحتاج الحالة الحالية لكل الزيارات القديمة
   * قبل بدء المستهلك الحي، لأن أحداثها السابقة لا تصلها بعد اليوم.
   *
   * @param tx معاملة الشركة التي فتحها المشغّل
   * @param companyId الشركة المالكة للزيارات
   * @param businessId النشاط المطلوب قراءته
   * @param range نطاق يومي العمل بصيغة YYYY-MM-DD
   * @param page مؤشر آخر زيارة في الصفحة السابقة وعدد الزيارات المطلوبة
   * @returns صفحة الزيارات ومؤشر الصفحة التالية أو null عند آخر صفحة
   */
  readPage(
    tx: Tx,
    companyId: string,
    businessId: string,
    range: BootstrapTipRange,
    page: BootstrapTipPageRequest,
  ): Promise<BootstrapTipPage>;
}
