import type { LeaveEmployee } from './leave-types.ts';

// ارتباط نهايته اليوم أو قبله منتهٍ؛ القاعدة نفسها التي يطبّقها currentAttachment في packages/db.
function attachmentCurrent(
  attachment: LeaveEmployee['attachments'][number],
  today: string,
): boolean {
  return attachment.to === null || attachment.to > today;
}

/**
 * السجل لا يُفتح إلا بربط ساري في فرع يقرأه المدير؛ فرع بلا يوم معروف لا يمنح أهلية.
 *
 * @param employee الموظف وارتباطاته؛ بداية الارتباط لا تقيد أهلية السجل
 * @param days أيام الفروع المقروءة المحسوبة من الساعة المحقونة ومناطقها
 * @returns وجود ارتباط نهايته فارغة أو بعد يوم فرعه؛ النهاية مستبعدة
 */
export function historyEligible(
  employee: Pick<LeaveEmployee, 'attachments'> | null,
  days: readonly { branchId: string; today: string }[],
): boolean {
  return (
    employee?.attachments.some((attachment) => {
      const day = days.find((d) => d.branchId === attachment.branch_id);
      return day !== undefined && attachmentCurrent(attachment, day.today);
    }) === true
  );
}
