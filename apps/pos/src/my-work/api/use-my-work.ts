import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { WorkContext } from '../model/work-context';
import { workCalls } from './my-work-calls';

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

/**
 * خدمات الشهر بالأحدث أول، صفحة بصفحة، على موبايلها الشخصي (جهاز الاستقبال بيستعمل المتحكم).
 *
 * @param context مين بيفتح الشاشة
 * @param month الشهر المطلوب أو undefined للحالي
 * @param onRefused معالج رفض السيرفر
 * @returns استعلام الصفحات
 */
export function useWorkLines(
  context: WorkContext,
  month: string | undefined,
  onRefused: OnRefused,
) {
  return useInfiniteQuery({
    ...PERSONAL_READ,
    queryKey: ['my-work', context.identity, 'lines', month ?? 'current'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      guarded(
        () =>
          workCalls.lines({
            mode: context.mode,
            month,
            windowId: undefined,
            cursor: pageParam,
            signal,
          }),
        signal,
        onRefused,
      ),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
}

/**
 * متوسط تقييمها وعدده في الشهر الحالي؛ الرد بيحدد لوحده لو العمود مخفي (HIDDEN).
 *
 * @param context مين بيفتح الشاشة
 * @param onRefused معالج رفض السيرفر
 * @returns استعلام ملخص التقييم
 */
export function useRatingSummary(context: WorkContext, onRefused: OnRefused) {
  return useQuery({
    ...PERSONAL_READ,
    queryKey: ['my-work', context.identity, 'rating-summary'],
    queryFn: ({ signal }) => guarded(() => workCalls.ratingSummary(signal), signal, onRefused),
  });
}

/**
 * إكراميات الشهر حسب الطريقة؛ لو العمود مخفي الرد HIDDEN ومفيش بلوك.
 *
 * @param context مين بيفتح الشاشة
 * @param month الشهر المطلوب أو undefined للحالي
 * @param onRefused معالج رفض السيرفر
 * @returns استعلام الإكراميات
 */
export function useWorkTips(context: WorkContext, month: string | undefined, onRefused: OnRefused) {
  return useQuery({
    ...PERSONAL_READ,
    queryKey: ['my-work', context.identity, 'tips', month ?? 'current'],
    queryFn: ({ signal }) =>
      guarded(
        () => workCalls.tips({ mode: context.mode, month, windowId: undefined, signal }),
        signal,
        onRefused,
      ),
  });
}
