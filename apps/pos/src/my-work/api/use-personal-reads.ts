import type { WorkContext } from '../model/work-context';
import type { MountScope } from './use-mount-scope';
import { type OnRefused, useRatingSummary, useWorkTips } from './use-my-work';
import { useReadThisVisit } from './use-read-this-visit';

/**
 * إكراميات موبايلها الشخصي، والبيانات ما بترجعش من الكاش إلا بعد ما السيرفر يرد بنجاح على قراءة الشهر ده في الزيارة دي،
 * وأي خطأ حالي في القراءة بيخفيها.
 *
 * @param context مين بيفتح الشاشة
 * @param scope مساحة مفاتيح الزيارة الحالية
 * @param month الشهر المعروض أو undefined قبل أول رد خدمات
 * @param onRefused معالج رفض السيرفر
 * @returns الاستعلام نفسه (للخطأ وإعادة المحاولة) والبيانات المثبتة بس
 */
export function usePersonalTips(
  context: WorkContext,
  scope: MountScope,
  month: string | undefined,
  onRefused: OnRefused,
) {
  const query = useWorkTips(context, scope, month, onRefused);
  const proven = useReadThisVisit(`${context.identity}:tips:${month}`, query);
  return { query, data: proven ? query.data : undefined };
}

/**
 * ملخص تقييم موبايلها الشخصي، بنفس شرط الإثبات: ما يتعرضش إلا بعد رد ناجح من السيرفر في الزيارة دي، ولو قراءة
 * لاحقة منه فشلت (403 مثلاً) بيختفي.
 *
 * @param context مين بيفتح الشاشة
 * @param scope مساحة مفاتيح الزيارة الحالية
 * @param onRefused معالج رفض السيرفر
 * @returns ملخص التقييم المثبت، أو undefined
 */
export function usePersonalRating(context: WorkContext, scope: MountScope, onRefused: OnRefused) {
  const query = useRatingSummary(scope, onRefused);
  const proven = useReadThisVisit(`${context.identity}:rating`, query);
  return proven ? query.data : undefined;
}
