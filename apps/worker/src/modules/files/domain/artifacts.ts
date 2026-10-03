/** نوع الجسم الداخلي الذي لا يحق له البقاء كوثيقة منشورة. */
export type ArtifactKind = 'STAGING' | 'CANDIDATE';
/** مطالبة حذف داخلية مع موعد إعادة المصالحة؛ لا تدخل Redis. */
export interface CleanupArtifact {
  id: string;
  fileId: string;
  key: string;
  kind: ArtifactKind;
  expiryAt: Date;
}
/** دفعة ثابتة تحد IO وحجز الصفوف في كل مصالحة. */
export const ARTIFACT_BATCH_SIZE = 50;
/** يعطي IO القديم مهلة بعد انتهاء التحقق، قبل تنظيف نسخته غير المنشورة.
 *
 * @param until نهاية مطالبة التحقق
 * @returns أول موعد آمن لتنظيف المرشح
 */
export function candidateCleanupAfter(until: Date): Date {
  return new Date(until.getTime() + 20 * 60_000);
}
/** الإنشاء مسجل بعد التوقيع؛ ثانية إضافية تفصل التنظيف عن حد صلاحية PUT.
 *
 * @param createdAt وقت إنشاء الطلب بعد التوقيع
 * @returns الموعد الذي يجب إعادة حذف staging بعده
 */
export function stagingExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + 121_000);
}
/** تعيد فحص المفاتيح المحذوفة حتى لا تبقى كتابة متأخرة من عامل قديم للأبد.
 *
 * @param kind نوع الجسم الداخلي
 * @param expiryAt نهاية نافذة الكتابة الأصلية
 * @param at وقت الحذف الحالي
 * @returns موعد المصالحة التالية، بعد PUT أو بعد يوم
 */
export function nextArtifactCleanup(kind: ArtifactKind, expiryAt: Date, at: Date): Date {
  return kind === 'STAGING' && at < expiryAt ? expiryAt : new Date(at.getTime() + 24 * 60 * 60_000);
}
