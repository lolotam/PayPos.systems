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
 * المعرّف بيترد بحروف صغيرة عشان يطابق الصف اللي بترجّعه قاعدة البيانات.
 *
 * @param input التصنيف المطلوب من العميل: معرّف، أو `null` للمسح، أو غيابه للإبقاء
 * @param current التصنيف المخزّن حالياً
 * @returns التصنيف التالي
 */
export function nextCategoryId(
  input: string | null | undefined,
  current: string | null,
): string | null {
  return input === undefined ? current : normalizeUuid(input);
}

/**
 * يوحّد معرّف UUID بحروف صغيرة: العقد بيقبل UUID بحروف كبيرة، وبوستجرس بترجّع `uuid` بحروف صغيرة.
 * من غير التوحيد، البحث بالمعرّف بيفوّت الصف اللي القاعدة رجّعته، والمقارنة بتشوف تغيير مش موجود.
 *
 * @param id المعرّف كما وصل، أو `null`
 * @returns المعرّف بحروف صغيرة، أو `null`
 */
export function normalizeUuid(id: string | null): string | null {
  return id === null ? null : id.toLowerCase();
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
  return [
    ...new Set([currentCategoryId, nextCategoryId].filter((id): id is string => id !== null)),
  ].sort();
}

/**
 * يتأكد إن التصنيف قابل للتعيين: لازم يكون في النشاط نفسه ومفتوح.
 * تصنيف نشاط تاني بيترد كأنه مش موجود عشان الرد ما يكشفش وجوده؛ المقفول له رد خاص بيه.
 * مقارنة النشاط بتتم بحروف صغيرة: المسار بيوصل بحروف كبيرة والقاعدة بترجّعها صغيرة.
 *
 * @param category الصف المقفل، أو `null` لو مش موجود في النشاط
 * @param businessId النشاط المالك للخدمة
 * @returns لا شيء عند القبول، ويرفض بخطأ مسمّى
 */
export function assertCategoryAssignable(
  category: { readonly business_id: string; readonly closed_at: string | null } | null,
  businessId: string,
): void {
  if (category === null || normalizeUuid(category.business_id) !== normalizeUuid(businessId))
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
