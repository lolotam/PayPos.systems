/** owner decision 2026-10-03: مهجور 24 ساعة، مرفوض سبعة أيام. retired بلا عمر: الأهلية هي المؤشر. */
export type RetentionKind = 'abandoned' | 'rejected' | 'retired';
/** دفعة صغيرة وحد مطالبة يستوعب مهلة المزود لكل عناصرها. */
export const RETENTION_BATCH_SIZE = 50;
/** وقت أهلية الحذف؛ الحد شامل ولا يعتمد على ساعة مخفية.
 * retired يرجع now لأن الأهلية المؤشر لا العمر.
 *
 * @param kind نوع الاحتفاظ
 * @param now الوقت المحقون
 * @returns أقدم وقت يجب الاحتفاظ بما بعده
 */
export function retentionCutoff(kind: RetentionKind, now: Date): Date {
  const hours = kind === 'abandoned' ? 24 : kind === 'rejected' ? 7 * 24 : 0;
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}
/** يتقاعد الملف السابق فقط عندما يكفّ النشاط عن الإشارة إليه تحت قفل الإعدادات.
 * إعادة الربط تحت نفس القفل تبقي الملف.
 *
 * @param stillReferenced هل logo_file_id ما زال هذا الملف
 * @returns هل تُكتب علامة purge_started_at
 */
export function shouldRetireUnreferencedLogo(stillReferenced: boolean): boolean {
  return !stillReferenced;
}
/** حد مطالبة قابل للتعافي بعد توقف العامل.
 *
 * @param now وقت المطالبة
 * @returns انتهاء المطالبة
 */
export function retentionLeaseUntil(now: Date): Date {
  return new Date(now.getTime() + 20 * 60 * 1000);
}
