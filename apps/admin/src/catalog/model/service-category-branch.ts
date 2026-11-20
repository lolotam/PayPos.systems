import type { ServiceCategoryBranchListItem } from '@pospay/contracts';

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
