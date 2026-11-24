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

/** هوية اتصال واحدة كما تقرأها قاعدة البيانات نفسها: الاسم ومعرّف الكلاستر واعة الوقوف على احتياطي. */
export interface ConnectionIdentity {
  readonly databaseName: string;
  readonly systemId: string;
  readonly inRecovery: boolean;
}

/**
 * يرفض توجيهاً غير آمن قبل تشغيل التقرير: الذراع الاحتياطي مرفوض حتى لو تطابقت الهوية لأن النسخة
 * المتزامنة تحمل الاسم ومعرّف الكلاستر نفسهما، واختلاف الاسم أو المعرّف يكشف وصلة خاطئة.
 * قرار نقي بقيم محقونة بلا SQL ولا ساعة جهاز، ويُختبر وحدوياً.
 *
 * @param report     هوية اتصال التقرير (pospay_app)
 * @param dispatcher هوية اتصال الإصدار (pospay_dispatcher) من لقطة الدالة المحدودة
 */
export function assertSamePrimary(report: ConnectionIdentity, dispatcher: ConnectionIdentity): void {
  if (report.inRecovery || dispatcher.inRecovery)
    throw new CoverageProofRefused('COVERAGE_REPLICA_REFUSED');
  if (report.databaseName !== dispatcher.databaseName || report.systemId !== dispatcher.systemId)
    throw new CoverageProofRefused('COVERAGE_DATABASE_MISMATCH');
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
