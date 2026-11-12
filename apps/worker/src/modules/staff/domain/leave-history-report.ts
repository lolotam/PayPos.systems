export type LeaveHistoryReportErrorDecision =
  | 'LEAVE_HISTORY_REPORT_FAILED'
  | 'LEAVE_HISTORY_REPORT_TOO_LARGE'
  | 'RETRY';

/**
 * يحوّل فشل البناء إلى رمز آمن؛ أخطاء المهلة والإلغاء والمدخل الدائم لا تستفيد من إعادة المحاولة.
 *
 * @param error الخطأ الملتقط من معاملة البناء دون قراءة رسالته أو تفاصيل السائق
 * @returns رمز فشل دائم أو قرار إعادة المحاولة
 */
export function classifyLeaveHistoryReportError(error: unknown): LeaveHistoryReportErrorDecision {
  if (error instanceof Error && error.name === 'LeaveHistoryReportTooLargeError') {
    return 'LEAVE_HISTORY_REPORT_TOO_LARGE';
  }
  const sqlState =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (
    (error instanceof Error &&
      ['LeaveHistoryReportDeadlineError', 'LeaveHistoryReportInputError', 'TimeoutError'].includes(
        error.name,
      )) ||
    sqlState === '57014' ||
    sqlState === '25P03'
  ) {
    return 'LEAVE_HISTORY_REPORT_FAILED';
  }
  return 'RETRY';
}

/**
 * يقارن عدد الصفوف بالحد المحقون حتى يبقى الاختبار بحد صغير مطابقًا لقرار الإنتاج.
 *
 * @param rowCount عدد الصفوف التي كشفها الاستعلام أو أُدخلت فعلًا
 * @param rowCap الحد الأقصى المسموح به في التقرير
 * @returns true عند تجاوز الحد، أما العدد المساوي للحد فمقبول
 */
export function leaveHistoryReportExceedsRowCap(rowCount: number, rowCap: number): boolean {
  return rowCount > rowCap;
}
