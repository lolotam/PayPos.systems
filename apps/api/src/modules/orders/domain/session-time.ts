import {
  SessionTimeError,
  isLateEntry as kernelIsLateEntry,
  sessionBusinessDate as kernelSessionBusinessDate,
  sessionTime as kernelSessionTime,
  validateAppendWindow as kernelValidateAppendWindow,
  visitInstant as kernelVisitInstant,
} from '@pospay/domain';
import { SessionError } from './session-error.ts';

function preserveSessionError(error: unknown): never {
  if (error instanceof SessionTimeError) throw new SessionError(error.code);
  throw error;
}

/**
 * غلاف API ليوم المحاسبة يحافظ على نوع SessionError لكل المستهلكين الحاليين.
 *
 * @param at اللحظة المطلوب تفسيرها
 * @param timezone منطقة النشاط المحفوظة
 * @returns التاريخ المدني بصيغة YYYY-MM-DD
 */
export function sessionBusinessDate(at: Date, timezone: string): string {
  try { return kernelSessionBusinessDate(at, timezone); }
  catch (error) { preserveSessionError(error); }
}
/**
 * غلاف API لمقارنة يوم التنفيذ والتسجيل يحافظ على نوع SessionError.
 *
 * @param occurredDate يوم تنفيذ الخدمة
 * @param recordedDate يوم حفظها
 * @returns هل التنفيذ في يوم أسبق
 */
export function isLateEntry(occurredDate: string, recordedDate: string): boolean {
  try { return kernelIsLateEntry(occurredDate, recordedDate); }
  catch (error) { preserveSessionError(error); }
}
/**
 * غلاف API لنافذة الإضافة يحافظ على نوع SessionError عند الرفض.
 *
 * @param businessDate اليوم المحفوظ للزيارة
 * @param recordedAt الوقت الحالي المحقون
 * @param timezone توقيت النشاط الأصلي
 * @returns لا شيء؛ التاريخ خارج النافذة يرفض
 */
export function validateAppendWindow(businessDate: string, recordedAt: Date, timezone: string): void {
  try { kernelValidateAppendWindow(businessDate, recordedAt, timezone); }
  catch (error) { preserveSessionError(error); }
}
/**
 * غلاف API لتطبيع لحظة الزيارة يحافظ على نوع SessionError عند الرفض.
 *
 * @param occurredAt وقت التنفيذ المدخل أو الغائب
 * @param recordedAt ساعة السيرفر
 * @returns اللحظة المطبّعة التي تُحفظ بها الزيارة
 */
export function visitInstant(occurredAt: Date | undefined, recordedAt: Date): Date {
  try { return kernelVisitInstant(occurredAt, recordedAt); }
  catch (error) { preserveSessionError(error); }
}
/**
 * غلاف API لوقت الجلسة يحافظ على نوع SessionError وأكواده الحالية.
 *
 * @param occurredAt وقت التنفيذ المدخل أو الغائب
 * @param recordedAt ساعة السيرفر بعد الأقفال
 * @param timezone توقيت المحاسبة
 * @returns الوقت المطبع ويوم المحاسبة وراية التأخر
 */
export function sessionTime(occurredAt: Date | undefined, recordedAt: Date, timezone: string) {
  try { return kernelSessionTime(occurredAt, recordedAt, timezone); }
  catch (error) { preserveSessionError(error); }
}
