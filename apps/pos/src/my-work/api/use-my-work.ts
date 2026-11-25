import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { WorkContext } from '../model/work-context';
import { workCalls } from './my-work-calls';
import type { MountScope } from './use-mount-scope';

// القراءات ما بتتجددش لوحدها ولا بتفضل في الكاش بعد ما الشاشة تتقفل.
const PERSONAL_READ = {
  gcTime: 0,
  staleTime: 0,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

/** رفض السيرفر على موبايلها الشخصي: بس انتهاء الجلسة (401) بيتعالج، وباقي الأخطاء بتظهر في الشاشة. */
export type OnRefused = (error: unknown) => void;

async function guarded<T>(read: () => Promise<T>, signal: AbortSignal, onRefused: OnRefused) {
  try {
    return await read();
  } catch (error) {
    if (!signal.aborted) onRefused(error);
    throw error;
  }
}

/** مؤشر الصفحة التالية ومعاه شهر الصفحة اللي طلعته: الصفحات التالية بتتطلب بالشهر ده مش بـ«الحالي» اللي ممكن يكون اتغيّر. */
type PageParam = { cursor: string; month: string };

/**
 * خدمات الشهر بالأحدث أول، صفحة بصفحة، على موبايلها الشخصي (جهاز الاستقبال بيستعمل المتحكم).
 * الصفحة الأولى من غير شهر بتتحدد بشهر السيرفر، وكل صفحة بعدها بتتبعت بالشهر اللي رجعته الصفحة اللي قبلها،
 * فعبور منتصف الليل بين صفحتين مبيخلطش الشهور ومبيبوّظش المؤشر.
 *
 * @param context مين بيفتح الشاشة
 * @param scope مساحة مفاتيح الزيارة الحالية
 * @param month الشهر المطلوب أو undefined للحالي
 * @param onRefused معالج رفض السيرفر
 * @param enabled false بعد رفض الصلاحية، فالقراءة ما بتتعادش ولا بترجع صفحات اتمسحت من الكاش
 * @returns استعلام الصفحات
 */
export function useWorkLines(
  context: WorkContext,
  scope: MountScope,
  month: string | undefined,
  onRefused: OnRefused,
  enabled = true,
) {
  return useInfiniteQuery({
    ...PERSONAL_READ,
    enabled,
    queryKey: [...scope, 'lines', month ?? 'current'],
    initialPageParam: undefined as PageParam | undefined,
    queryFn: ({ pageParam, signal }) =>
      guarded(
        () =>
          workCalls.lines({
            mode: context.mode,
            month: pageParam?.month ?? month,
            windowId: undefined,
            cursor: pageParam?.cursor,
            signal,
          }),
        signal,
        onRefused,
      ),
    getNextPageParam: (page) =>
      page.next_cursor ? { cursor: page.next_cursor, month: page.month } : undefined,
  });
}

/**
 * متوسط تقييمها وعدده في الشهر الحالي؛ الرد بيحدد لوحده لو العمود مخفي (HIDDEN).
 *
 * @param scope مساحة مفاتيح الزيارة الحالية
 * @param onRefused معالج رفض السيرفر
 * @returns استعلام ملخص التقييم
 */
export function useRatingSummary(scope: MountScope, onRefused: OnRefused) {
  return useQuery({
    ...PERSONAL_READ,
    queryKey: [...scope, 'rating-summary'],
    queryFn: ({ signal }) => guarded(() => workCalls.ratingSummary(signal), signal, onRefused),
  });
}

/**
 * إكراميات الشهر حسب الطريقة؛ لو العمود مخفي الرد HIDDEN ومفيش بلوك. بتتطلب دايماً بشهر صريح: الشهر
 * المعروض (شهر أول صفحة خدمات لو الموظفة لسه ما اختارتش)، فمتتحسبش «الحالي» بشكل مستقل عن الخدمات.
 *
 * @param context مين بيفتح الشاشة
 * @param scope مساحة مفاتيح الزيارة الحالية
 * @param month الشهر المعروض، أو undefined قبل أول رد خدمات (القراءة بتستنى)
 * @param onRefused معالج رفض السيرفر
 * @returns استعلام الإكراميات
 */
export function useWorkTips(
  context: WorkContext,
  scope: MountScope,
  month: string | undefined,
  onRefused: OnRefused,
) {
  return useQuery({
    ...PERSONAL_READ,
    queryKey: [...scope, 'tips', month],
    enabled: month !== undefined,
    queryFn: ({ signal }) =>
      guarded(
        () => workCalls.tips({ mode: context.mode, month, windowId: undefined, signal }),
        signal,
        onRefused,
      ),
  });
}

/**
 * تقدير عمولتها للشهر المعروض؛ لو العمود مخفي أو العمولات متوقفة الرد HIDDEN أو الرفض 403 ومفيش كارت. بتتطلب بشهر
 * صريح زي الإكراميات، فمتتحسبش «الحالي» بشكل مستقل عن الخدمات.
 *
 * @param context مين بيفتح الشاشة
 * @param scope مساحة مفاتيح الزيارة الحالية
 * @param month الشهر المعروض، أو undefined قبل أول رد خدمات (القراءة بتستنى)
 * @param onRefused معالج رفض السيرفر
 * @returns استعلام التقدير
 */
export function useWorkCommissionEstimate(
  context: WorkContext,
  scope: MountScope,
  month: string | undefined,
  onRefused: OnRefused,
) {
  return useQuery({
    ...PERSONAL_READ,
    queryKey: [...scope, 'commission-estimate', month],
    enabled: month !== undefined,
    queryFn: ({ signal }) =>
      guarded(
        () =>
          workCalls.commissionEstimate({ mode: context.mode, month, windowId: undefined, signal }),
        signal,
        onRefused,
      ),
  });
}
