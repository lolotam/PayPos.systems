/**
 * يسمح ببدء الطلب قبل الموعد فقط؛ عدم وجود ساعات يعني عدم وجود موعد.
 *
 * @param deadline الموعد المطلق أو null
 * @param now الوقت المتحقن
 * @returns هل بدء الإرسال ما زال مسموحًا
 */
export function mayStart(deadline: Date | null, now: Date): boolean {
  return deadline === null || now.getTime() < deadline.getTime();
}

/**
 * يحسب مهلة التقييم من الإغلاق مع سماح نصف ساعة، لا ينقل الطلب لليوم التالي.
 *
 * @param closing وقت إغلاق الفرع أو null لو الساعات غير موجودة
 * @returns موعد الإرسال الأخير أو null
 */
export function closingDeadline(closing: Date | null): Date | null {
  return closing === null ? null : new Date(closing.getTime() + 30 * 60_000);
}

/**
 * مسح وجهة تنفيذ متوقف لا يسمح بإعادة الإرسال ولا يختلق نتيجة.
 *
 * @param sendingAt وقت حيازة حق التنفيذ
 * @param now الوقت المتحقن
 * @param executionStopped تأكيد توقف التنفيذ أو تصريفه
 * @returns هل مر يوم كامل والتنفيذ متوقف
 */
export function mayClearDestination(
  sendingAt: Date | null,
  now: Date,
  executionStopped: boolean,
): boolean {
  return (
    executionStopped &&
    sendingAt !== null &&
    now.getTime() - sendingAt.getTime() >= 24 * 60 * 60_000
  );
}
