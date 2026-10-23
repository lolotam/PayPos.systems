import { staffColumnCode, type StaffColumnCode } from '@pospay/contracts';

// rating_average مستخبي لحد ما التقييم يرجع (D-A7): السيرفر بيرفض أي مجموعة فيها الكود ده، والشاشة ما تعرضوش.
// 61-3 هي اللي بترفع الحظر: الكود بيرجع للقائمة المعروضة من غير أي تغيير تاني.
const POSTPONED: readonly StaffColumnCode[] = ['rating_average'];

/** نوع الكود اللي الشاشة بتعرضه: كل أكواد العقد ما عدا rating_average. */
export type OfferedStaffColumnCode = Exclude<StaffColumnCode, 'rating_average'>;

/** الأعمدة المعروضة في شاشة أعمدة تطبيق الموظفين، بترتيب أكواد العقد. */
export function offeredStaffColumns(): readonly OfferedStaffColumnCode[] {
  return staffColumnCode.options.filter(
    (code): code is OfferedStaffColumnCode => !POSTPONED.includes(code),
  );
}
