/** رفض إصدار لا يحمل بيانات عميلة أو نص SQL. */
export class CoverageProofRefused extends Error {
  override readonly name = 'CoverageProofRefused';
  readonly code: string;
  /** ينشئ رفضاً برمز ثابت فقط.
   *
   * @param code سبب الرفض الآمن للطباعة
   */
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** الأقسام المطلوبة لإثبات التغطية بلا الاعتماد على عنوان التقرير وحده. */
export interface IssuableCoverageReport {
  readonly status: string;
  readonly truncated: boolean;
  readonly lines: { missing: { total: number }; stale: { total: number } };
  readonly salaries: { missing: { total: number }; stale: { total: number } };
  readonly sales: { missing: { total: number }; stale: { total: number } };
  readonly tips: { missing: { total: number }; stale: { total: number } } | null;
  readonly unmarked: { total: number };
  readonly notHandled: { total: number };
}

/** يمنع إصدار دليل من تقرير جزئي أو متناقض حتى لو حمل عنوان COVERED خطأً.
 *
 * @param report نتيجة الفحص بكل أقسام المصدر
 */
export function assertIssuableCoverage(report: IssuableCoverageReport): void {
  if (
    report.status !== 'COVERED' ||
    report.truncated ||
    report.tips === null ||
    report.unmarked.total !== 0 ||
    report.notHandled.total !== 0 ||
    [report.lines, report.salaries, report.sales, report.tips].some(
      (part) => part === null || part.missing.total !== 0 || part.stale.total !== 0,
    )
  )
    throw new CoverageProofRefused('COVERAGE_REPORT_NOT_COVERED');
}
