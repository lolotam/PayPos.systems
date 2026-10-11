import type { AttendanceMonthlyReport } from '@pospay/contracts';

/** طلب التقرير بعد إثبات هوية القارئ والشركة؛ النطاق يُعاد إثباته داخل المعاملة. */
export interface AttendanceReportRequest {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string;
  month: string;
}

/** قراءة التقرير وتسجيل تنزيله يشتركان في المعاملة حتى لا ينجح تنزيل بلا أثر تدقيق. */
export interface AttendanceReportContext {
  report: AttendanceMonthlyReport;
  /**
   * يسجل الشهر والنطاق المقروءين مرة واحدة مع الفاعل المثبت في المعاملة.
   *
   * @returns اكتمال كتابة التدقيق قبل نجاح التنزيل
   */
  recordDownload(): Promise<void>;
}

/** حد قاعدة البيانات يتيح للتصدير تنسيق الملف والتدقيق دون معرفة تقنية التخزين. */
export interface AttendanceReportTransactions {
  /**
   * يثبت النطاق ويقرأ مدخلات الشهر ثم يتيح التدقيق في المعاملة نفسها.
   *
   * @param request الشركة والقارئ والنطاق والشهر المطلوب
   * @param work العمل الذي يحتاج التقرير وسجل التدقيق داخل المعاملة
   * @returns نتيجة العمل بعد اكتمال المعاملة
   */
  run<T>(request: AttendanceReportRequest, work: (context: AttendanceReportContext) => Promise<T>): Promise<T>;
}

/** تنسيق الملف محول خارجي لأن اللغة وترميز Excel لا يغيران قواعد ساعات الحضور. */
export interface AttendanceReportCsv {
  /**
   * يعرض الأعمدة المصرح بها بترميز CSV العربي المطلوب للتنزيل.
   *
   * @param report التقرير المحسوب دون الحقول الخاصة
   * @returns ملف عربي بترميز Excel المطلوب
   */
  render(report: AttendanceMonthlyReport): string;
}
