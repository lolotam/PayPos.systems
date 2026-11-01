import { ServiceError } from './errors.ts';

/** صف التصنيف كما يحتاجه التعيين: هوية النشاط والاسمان ووقت الإغلاق. */
export interface ServiceCategoryLock {
  readonly id: string;
  readonly business_id: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly closed_at: string | null;
}

/**
 * يقرر التصنيف التالي بعد التعديل: الغياب يعني الإبقاء على المخزّن، و`null` يعني المسح.
 * التمييز بين الغياب والقيمة الفارغة هو الفرق بين عميل ما يعرفش الحقل وعميل طلب المسح.
 *
 * @param input التصنيف المطلوب من العميل: معرّف، أو `null` للمسح، أو غيابه للإبقاء
 * @param current التصنيف المخزّن حالياً
 * @returns التصنيف التالي
 */
export function nextCategoryId(
  input: string | null | undefined,
  current: string | null,
): string | null {
  return input === undefined ? current : input;
}

/**
 * ترتيب الأقفال: المعرّفات المختلفة غير الفارغة مرتبة تصاعدياً.
 * كل كتابة على التصنيف تاخد أقفالها بنفس الترتيب عشان ما يحصلش تعارض بين قفل وإغلاق.
 *
 * @param currentCategoryId التصنيف المخزّن حالياً
 * @param nextCategoryId التصنيف التالي
 * @returns المعرّفات المرتبة تصاعدياً، بلا تكرار
 */
export function categoriesToLock(
  currentCategoryId: string | null,
  nextCategoryId: string | null,
): string[] {
  return [...new Set([currentCategoryId, nextCategoryId].filter((id): id is string => id !== null))].sort();
}

/**
 * يتأكد إن التصنيف قابل للتعيين: لازم يكون في النشاط نفسه ومفتوح.
 * التصنيف المغلق أو اللي في نشاط تاني بيتعامل كأنه مش موجود، عشان ما نكشفش حاجة عن غيرنا.
 *
 * @param category الصف المقفل، أو `null` لو مش موجود في النشاط
 * @param businessId النشاط المالك للخدمة
 * @returns لا شيء عند القبول، ويرفض بخطأ مسمّى
 */
export function assertCategoryAssignable(
  category: { readonly business_id: string; readonly closed_at: string | null } | null,
  businessId: string,
): void {
  if (category === null || category.business_id !== businessId)
    throw new ServiceError('SERVICE_CATEGORY_NOT_FOUND');
  if (category.closed_at !== null) throw new ServiceError('SERVICE_CATEGORY_CLOSED');
}

/**
 * يقول إن التصنيف اتغير فعلاً؛ التصنيف نفسه لا يتغير لو العميل بعت نفس المعرّف.
 *
 * @param currentCategoryId التصنيف المخزّن حالياً
 * @param nextCategoryId التصنيف التالي
 * @returns هل التصنيف مختلف
 */
export function categoryChanged(
  currentCategoryId: string | null,
  nextCategoryId: string | null,
): boolean {
  return currentCategoryId !== nextCategoryId;
}
