/** رموز فشل قفل أو فتح التصنيف: العامل يكتبها في صف الطلب، والعقد يحمل القائمة نفسها. */
export const SERVICE_CATEGORY_CLOSING_FAILURES = [
  'SERVICE_CATEGORY_REVISION_CONFLICT',
  'SERVICE_CATEGORY_ALREADY_CLOSED',
  'SERVICE_CATEGORY_NOT_CLOSED',
  'SERVICE_CATEGORY_COUNT_CHANGED',
  'SERVICE_CATEGORY_CLOSING_EXPIRED',
  'SERVICE_CATEGORY_CLOSING_FAILED',
] as const;

/** رمز الفشل الواحد الذي تكتبه المهمة على صف الطلب. */
export type ServiceCategoryClosingFailure = (typeof SERVICE_CATEGORY_CLOSING_FAILURES)[number];

/** صف الطلب كما يخزّنه القاعدة: الفعل والحالة والنسخة المتوقعة والعدد والموعد. */
export interface ServiceCategoryClosingJob {
  readonly action: 'close' | 'reopen';
  readonly status: 'pending' | 'completed' | 'failed';
  readonly expectedRevision: number;
  readonly expectedServiceCount: number;
  readonly deadlineAt: Date;
}

/** التصنيف المقفول: نسخته وحالة الإغلاق وقت الفحص تحت القفل. */
export interface LockedServiceCategory {
  readonly revision: number;
  readonly closedAt: Date | null;
}

/** قرار تشغيل الوظيفة: لا عمل، أو فشل برمز معروف، أو المتابعة. */
export type ServiceCategoryClosingDecision = 'proceed' | 'noop' | ServiceCategoryClosingFailure;

/**
 * يقرر مصير طلب القفل أو الفتح قبل لمس خدمات التصنيف.
 * ترتيب الفحص هو ترتيب مسار الـ API المتزامن: الموعد أولاً لأن الطلب المنتهي لا ينفع، ثم النسخة
 * لأنها أقدم دليل على تعديل، ثم حالة التصنيف، ثم العدد. الصف اللي خلص فعلاً ما بينفعش يتعاد
 * تشغيله، فالنتيجة بتكون لا عمل مش فشل.
 *
 * @param job      صف الطلب: الفعل والحالة والنسخة والعدد المتوقع والموعد النهائي
 * @param category التصنيف المقفول: نسخته وحالة الإغلاق وقت الفحص
 * @param now      اللحظة المحقونة التي يُقاس بها الموعد
 * @returns لا عمل، أو رمز الفشل، أو المتابعة في تنفيذ القفل أو الفتح
 */
export function decideServiceCategoryClosing(
  job: ServiceCategoryClosingJob,
  category: LockedServiceCategory,
  now: Date,
): ServiceCategoryClosingDecision {
  if (job.status !== 'pending') return 'noop';
  if (now.getTime() >= job.deadlineAt.getTime()) return 'SERVICE_CATEGORY_CLOSING_EXPIRED';
  if (job.expectedRevision !== category.revision) return 'SERVICE_CATEGORY_REVISION_CONFLICT';
  if (job.action === 'close' && category.closedAt !== null)
    return 'SERVICE_CATEGORY_ALREADY_CLOSED';
  if (job.action === 'reopen' && category.closedAt === null) return 'SERVICE_CATEGORY_NOT_CLOSED';
  return 'proceed';
}

/**
 * يقارن عدد الخدمات المقفولة بالعدد الذي أكّده المدير وقت القبول.
 * الاختلاف معناه إن مجموعة الخدمات اتغيّرت بعد التأكيد، فالتشغيل يوقف والصف بيفشل بالرمز
 * بتاع تغيّر العدد بدل ما يقفل مجموعة غير اللي طلبها المدير.
 *
 * @param expectedServiceCount  العدد الذي أكّده المدير وقت القبول
 * @param lockedServiceCount    عدد الخدمات التي قفلتها المعاملة فعلاً
 * @returns المتابعة، أو رمز فشل تغيّر العدد
 */
export function decideServiceCategoryClosingCount(
  expectedServiceCount: number,
  lockedServiceCount: number,
): 'proceed' | 'SERVICE_CATEGORY_COUNT_CHANGED' {
  return expectedServiceCount === lockedServiceCount ? 'proceed' : 'SERVICE_CATEGORY_COUNT_CHANGED';
}
