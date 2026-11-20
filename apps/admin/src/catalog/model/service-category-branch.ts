import type { ServiceCategoryBranchListItem, ServiceCategoryBranchView } from '@pospay/contracts';

/**
 * بيميّز لفرع واحد بين تصنيفه الخاص والتصنيف المخفي عنه في قايمة القراءة بس.
 * التصنيف المشترك اللي الفرع هو اللي أنشأه مش بيتعدّ تابع له: بعد ما بقى مشترك الفرع
 * مش هيعرف يعدّل اسمه، فالعلامة بتاعة «بتاع الفرع ده» للخاص بس.
 *
 * @param item     بند قايمة الفرع بظهور التصنيف وحالة إعداد الفرع عنده
 * @param branchId الفرع اللي بيفتح القايمة
 * @returns علامتين مستقلتين: «بتاع الفرع ده» و«مخفي عندك» — ممكن يجتمعوا أو يبقوا فاضيين
 */
export function branchCategoryMarks(
  item: Pick<ServiceCategoryBranchListItem, 'visibility' | 'owner_branch_id' | 'setting_state'>,
  branchId: string,
): { ownedHere: boolean; hiddenHere: boolean } {
  return {
    ownedHere: item.visibility === 'BRANCH' && item.owner_branch_id === branchId,
    hiddenHere: item.setting_state === 'HIDDEN',
  };
}

/**
 * بيحدد أزرار الفرع على البند حسب القايمة: الإخفاء في «مستخدمة» والتفعيل في «متاحة»،
 * وإعادة التسمية والمشاركة لتصنيفه الخاص بس — أي محاولة تانية بيرفضها المسار بـ
 * SERVICE_CATEGORY_VISIBILITY_FIXED لأن المشترك بيتعدّل من مستوى النشاط (SI-Q23 وSI-Q25).
 *
 * @param item     بند قايمة الفرع بظهور التصنيف ومالكه
 * @param branchId الفرع اللي بيفتح القايمة
 * @param view     القايمة الحالية: «مستخدمة» أو «متاحة»
 * @returns الأزرار المتاحة على البند ده في القايمة دي
 */
export function branchCategoryActions(
  item: Pick<ServiceCategoryBranchListItem, 'visibility' | 'owner_branch_id'>,
  branchId: string,
  view: ServiceCategoryBranchView,
): { hide: boolean; enable: boolean; rename: boolean; share: boolean } {
  const ownPrivate = item.visibility === 'BRANCH' && item.owner_branch_id === branchId;
  return {
    hide: view === 'in_use',
    enable: view === 'available',
    rename: ownPrivate,
    share: ownPrivate,
  };
}
