/** حد القفل المتزامن: عدد الخدمات اللي القفل المتزامن يجاوب في حدود الـ 200 مللي. */
export const SERVICE_CATEGORY_SYNC_CLOSING_LIMIT = 300;

/** مسار تنفيذ القفل أو الفتح: متزامن على طول، أو مهمة في الخلفية فوق الحد. */
export type ServiceCategoryClosingPath = 'sync' | 'job';

/** الطلب الجديد: الفعل والنسخة والعدد اللي أكّدهم المدير. */
export interface ServiceCategoryClosingIntent {
  readonly action: 'close' | 'reopen';
  readonly expected_revision: number;
  readonly expected_service_count: number;
}

/** صف الطلب المعلق كما يُقرأ: هويته وفعله والنسخة والعدد المتوقع وموعده النهائي. */
export interface PendingServiceCategoryClosing {
  readonly id: string;
  readonly action: 'close' | 'reopen';
  readonly expected_revision: number;
  readonly expected_service_count: number;
  readonly deadline_at: Date;
}

/** صف الطلب الجديد كما يُكتب: هوية الطلب والتصنيف والفعل والنسخة والعدد والطالب والموعدين. */
export interface NewServiceCategoryClosing {
  readonly id: string;
  readonly business_id: string;
  readonly category_id: string;
  readonly action: 'close' | 'reopen';
  readonly expected_revision: number;
  readonly expected_service_count: number;
  readonly requested_by: string;
  readonly requested_at: Date;
  readonly deadline_at: Date;
}

/** قرار الطلب المعلق: لا طلب، أو نفس الطلب فيُعاد، أو منتهي فيُنهى، أو مختلف فيُرفض. */
export type ServiceCategoryClosingPendingDecision =
  | { readonly kind: 'none' }
  | { readonly kind: 'replay'; readonly closing_id: string }
  | { readonly kind: 'expired'; readonly closing_id: string }
  | { readonly kind: 'in_progress'; readonly closing_id: string };

/**
 * يختار مسار القفل أو الفتح من عدد الخدمات المتأثرة. الحد ٣٠٠ خدمة هو هامش أمان اختاره
 * القياس على جهاز مشترك محمّل: فوقه القفل المتزامن بيعدّي حدود الـ 200 مللي، فالتشغيل
 * بينتقل للمهمة في الخلفية بدل ما يبقى طلب متزامن واقف.
 *
 * @param count عدد الخدمات التي يمسّها القفل أو الفتح
 * @returns 'sync' لحد ٣٠٠ خدمة، و'job' فوقها
 */
export function serviceCategoryClosingPath(count: number): ServiceCategoryClosingPath {
  return count <= SERVICE_CATEGORY_SYNC_CLOSING_LIMIT ? 'sync' : 'job';
}

/**
 * يقرر مصير الطلب المعلق على التصنيف: الموعد أولاً لأن طلباً منتهياً ما ينفعش يتعاد
 * تشغيله، فالطلب المطابق بعد انتهائه ياخد طلب جديد. وبعدها المطابقة: نفس الفعل والنسخة
 * والعدد هو نفس الطلب فيُعاد بنفس هويته، وأي اختلاف فيهم طلب تاني فالتنفيذ شغّال بالفعل.
 *
 * @param pending الطلب المعلق على التصنيف، أو غيابه
 * @param intent  الطلب الجديد: الفعل والنسخة والعدد
 * @param now     اللحظة المحقونة اللي يُقاس بها الموعد النهائي
 * @returns القرار: لا طلب، أو إعادة تشغيل، أو انتهاء، أو تعارض
 */
export function decideServiceCategoryClosingPending(
  pending: PendingServiceCategoryClosing | null,
  intent: ServiceCategoryClosingIntent,
  now: Date,
): ServiceCategoryClosingPendingDecision {
  if (pending === null) return { kind: 'none' };
  if (now.getTime() >= pending.deadline_at.getTime())
    return { kind: 'expired', closing_id: pending.id };
  const same =
    pending.action === intent.action &&
    pending.expected_revision === intent.expected_revision &&
    pending.expected_service_count === intent.expected_service_count;
  return same
    ? { kind: 'replay', closing_id: pending.id }
    : { kind: 'in_progress', closing_id: pending.id };
}

/**
 * يحسب الموعد النهائي للطلب: وقت الطلب مضافاً إليه المدة المسموحة. الحساب هنا مش في
 * حالة الاستخدام، لأن الموعد قاعدة عمل مش خطوة تنفيذ.
 *
 * @param requestedAt وقت الطلب المحقون
 * @param deadlineMs  المدة المسموحة قبل انتهاء صلاحية الطلب
 * @returns الموعد النهائي للطلب
 */
export function serviceCategoryClosingDeadline(requestedAt: Date, deadlineMs: number): Date {
  return new Date(requestedAt.getTime() + deadlineMs);
}
