import { SessionError } from './session-error.ts';

/**
 * يحدد يوم المحاسبة بتوقيت النشاط بدلاً من منتصف ليل UTC.
 *
 * @param at اللحظة المطلوب تفسيرها
 * @param timezone منطقة النشاط المحفوظة
 * @returns التاريخ المدني بصيغة YYYY-MM-DD
 */
export function sessionBusinessDate(at: Date, timezone: string): string {
  try {
    if (!Number.isFinite(at.getTime())) throw new RangeError();
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
    const part = (type: string) => parts.find((p) => p.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch { throw new SessionError('SESSION_TIME_INVALID'); }
}
/**
 * التأخر يوم سابق، وليس مرور ساعتين في نفس اليوم حسب SS-Q9.
 *
 * @param occurredDate يوم تنفيذ الخدمة
 * @param recordedDate يوم حفظها
 * @returns هل التنفيذ في يوم أسبق
 */
export function isLateEntry(occurredDate: string, recordedDate: string): boolean { return occurredDate < recordedDate; }
/**
 * يحمي نافذة أول الشهر السابق عند وقت جديد بعد انتظار الأقفال.
 *
 * @param businessDate اليوم المحفوظ للزيارة
 * @param recordedAt الوقت الحالي المحقون
 * @param timezone توقيت النشاط الأصلي
 * @returns لا شيء؛ التاريخ خارج النافذة يرفض
 */
export function validateAppendWindow(businessDate: string, recordedAt: Date, timezone: string): void {
  const today = sessionBusinessDate(recordedAt, timezone);
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  const oldest = `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}-01`;
  if (businessDate < oldest) throw new SessionError('SESSION_TIME_TOO_OLD');
}
/**
 * يسمح بفرق ساعة الجهاز حتى ١٢٠ ثانية ويطبّعه لوقت السيرفر فلا نخزن مستقبلاً.
 *
 * @param occurredAt وقت التنفيذ المدخل أو الغائب
 * @param recordedAt ساعة السيرفر بعد الأقفال
 * @param timezone توقيت المحاسبة
 * @returns الوقت المطبع ويوم المحاسبة وراية التأخر
 */
export function sessionTime(occurredAt: Date | undefined, recordedAt: Date, timezone: string) {
  const candidate = occurredAt ?? recordedAt;
  if (!Number.isFinite(candidate.getTime()) || !Number.isFinite(recordedAt.getTime())) throw new SessionError('SESSION_TIME_INVALID');
  if (candidate.getTime() > recordedAt.getTime() + 120000) throw new SessionError('SESSION_TIME_IN_FUTURE');
  const occurred_at = candidate > recordedAt ? recordedAt : candidate;
  const business_date = sessionBusinessDate(occurred_at, timezone);
  validateAppendWindow(business_date, recordedAt, timezone);
  return { occurred_at, business_date, late: isLateEntry(business_date, sessionBusinessDate(recordedAt, timezone)) };
}
