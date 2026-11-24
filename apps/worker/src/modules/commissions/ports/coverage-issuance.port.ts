import type { CoverageIssuer } from '@pospay/db';

import type { CoverageTenantRunner, CoverageTx } from './commission-coverage.port.ts';

/** فحص الوجود من Orders، بلا سجلات عميلة أو مبالغ وبلا وصول مباشر عبر الموديولات. */
export interface CoverageTipExistenceReader {
  /** يرفض نشاطاً مجهولاً؛ true لأي مراجعة بقشيش بعد الحد دون سقف أعلى.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المفحوصة
   * @param businessId النشاط المفحوص
   * @param bound حد PostgreSQL اليومي
   */
  existsAfter(
    tx: CoverageTx,
    companyId: string,
    businessId: string,
    bound: string,
  ): Promise<boolean>;
}

/** هوية قاعدة التقرير ونسخة القواعد وحد ساعة PostgreSQL، كلها من الاتصال الذي يقرأ المصادر. */
export interface CoverageReportIdentity {
  readonly databaseName: string;
  readonly systemId: string;
  readonly version: number;
  readonly tipBound: string;
}

/** قدرات الإصدار؛ لا SQL ولا ساعة جهاز المشغّل في حالة الاستخدام. */
export interface CoverageIssuanceDependencies {
  readonly issuer: CoverageIssuer;
  readonly withTenant: CoverageTenantRunner;
  readonly tips: CoverageTipExistenceReader;
  /** يقرأ هوية الاتصال والحد الحالي للتحقق من توجيه الاتصال وانتقال منتصف الليل.
   *
   * @param companyId الشركة المفحوصة
   */
  identity(companyId: string): Promise<CoverageReportIdentity>;
  /** كل أنشطة الشركة من tenancy، حتى ترفض التجربة الجافة نطاقاً جزئياً أيضاً.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المفحوصة
   */
  businessIds(tx: CoverageTx, companyId: string): Promise<readonly string[]>;
}
