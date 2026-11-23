import type { WorkContext } from '../model/work-context';
import { type OnRefused, useRatingSummary, useWorkTips } from './use-my-work';
import { useReadThisVisit } from './use-read-this-visit';

/**
 * إكراميات موبايلها الشخصي، والبيانات ما بترجعش من الكاش إلا بعد ما السيرفر يرد بنجاح على قراءة الشهر ده في الزيارة دي.
 *
 * @param context مين بيفتح الشاشة
 * @param month الشهر المعروض أو undefined قبل أول رد خدمات
 * @param onRefused معالج رفض السيرفر
 * @returns الاستعلام نفسه (للخطأ وإعادة المحاولة) والبيانات المثبتة بس
 */
export function usePersonalTips(
  context: WorkContext,
  month: string | undefined,
  onRefused: OnRefused,
) {
  const query = useWorkTips(context, month, onRefused);
  const proven = useReadThisVisit(`${context.identity}:tips:${month}`, query);
  return { query, data: proven ? query.data : undefined };
}

/**
 * ملخص تقييم موبايلها الشخصي، بنفس شرط الإثبات: ما يتعرضش إلا بعد رد ناجح من السيرفر في الزيارة دي.
 *
 * @param context مين بيفتح الشاشة
 * @param onRefused معالج رفض السيرفر
 * @returns ملخص التقييم المثبت، أو undefined
 */
export function usePersonalRating(context: WorkContext, onRefused: OnRefused) {
  const query = useRatingSummary(context, onRefused);
  const proven = useReadThisVisit(`${context.identity}:rating`, query);
  return proven ? query.data : undefined;
}
