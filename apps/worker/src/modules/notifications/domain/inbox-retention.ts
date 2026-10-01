/**
 * يحدد حد الاحتفاظ بالحمولة دون انتهاء عمر المنع أو هوية dedupe.
 *
 * @param now الوقت المتحقن
 * @returns حد الثلاثين يوماً شاملاً
 */
export function inboxPayloadCutoff(now: Date): Date {
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
}
