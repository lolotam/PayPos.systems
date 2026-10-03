/** owner decision 2026-10-03: مهجور 24 ساعة، مرفوض سبعة أيام، ولا مسح للموثق. */
export type RetentionKind = 'abandoned' | 'rejected';
/** دفعة صغيرة وحد مطالبة يستوعب مهلة المزود لكل عناصرها. */
export const RETENTION_BATCH_SIZE = 50;
/** وقت أهلية الحذف؛ الحد شامل ولا يعتمد على ساعة مخفية.
 *
 * @param kind نوع الاحتفاظ
 * @param now الوقت المحقون
 * @returns أقدم وقت يجب الاحتفاظ بما بعده
 */
export function retentionCutoff(kind: RetentionKind, now: Date): Date {
  return new Date(now.getTime() - (kind === 'abandoned' ? 24 : 7 * 24) * 60 * 60 * 1000);
}
/** حد مطالبة قابل للتعافي بعد توقف العامل.
 *
 * @param now وقت المطالبة
 * @returns انتهاء المطالبة
 */
export function retentionLeaseUntil(now: Date): Date {
  return new Date(now.getTime() + 20 * 60 * 1000);
}
