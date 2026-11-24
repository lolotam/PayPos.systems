import { COMMISSION_INPUT_EVENT_TYPES } from '@pospay/domain';

/**
 * هل الحدث ده من الأنواع الستة اللي عدّاد الاعتماد يعدّها؟
 * التنبيه بيترفع للأنواع دي بس لأنها وحدها اللي بتوقف اعتماد شهر العمولة؛
 * أي نوع تاني لو وقف ما بيمنعش اعتماد، فمفيش داعي يوقظ المالك (ADR-0012 §1، A4).
 *
 * @param eventType اسم نوع الحدث في الـoutbox
 * @returns true لما يكون الحدث من الأنواع الستة المعدودة
 */
export function countsAsPendingCommissionEvent(eventType: string): boolean {
  return (COMMISSION_INPUT_EVENT_TYPES as readonly string[]).includes(eventType);
}
