import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { WorkContext } from '../model/work-context';
import { PrivateViewRetiredError } from '../model/work-error';
import { workCalls } from './my-work-calls';
import type { PrivateViewAccess } from './use-private-view';

// القراءات الخاصة ما بتتجددش لوحدها: على جهاز الاستقبال كل طلب بيمدد النافذة، فالتجديد التلقائي كان هيسيبها مفتوحة.
const PRIVATE_READ = {
  gcTime: 0,
  staleTime: 0,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

/**
 * قراءة خاصة محروسة. على جهاز الاستقبال الرد الناجح ما بيوصلش للكاش إلا لو نافذة الطلب لسه هي
 * الحالية (المفتاح المشترك والمواعيد)، من غير انتظار إشارة التخزين اللي ممكن توصل بعد الرد؛ وإلا بيترمى
 * والتاب بيتقفل (ADR-0019 البند 6: التاب بيعرض رد نافذته الحالية بس).
 */
async function guarded<T>(read: () => Promise<T>, signal: AbortSignal, view: PrivateViewAccess) {
  const windowId = view.windowId;
  let data: T;
  try {
    data = await read();
  } catch (error) {
    if (!signal.aborted) view.refused(error);
    throw error;
  }
  if (windowId !== undefined && !view.fence(windowId)) throw new PrivateViewRetiredError();
  return data;
}

/**
 * خدمات الشهر بالأحدث أول، صفحة بصفحة؛ من غير شهر السيرفر بيحدد الشهر الحالي.
 *
 * @param context مين بيفتح الشاشة
 * @param month الشهر المطلوب أو undefined للحالي
 * @param view رقم النافذة ومعالج الرفض
 * @returns استعلام الصفحات
 */
export function useWorkLines(
  context: WorkContext,
  month: string | undefined,
  view: PrivateViewAccess,
) {
  return useInfiniteQuery({
    ...PRIVATE_READ,
    queryKey: ['my-work', context.identity, 'lines', month ?? 'current'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      guarded(
        () =>
          workCalls.lines({
            mode: context.mode,
            month,
            windowId: view.windowId,
            cursor: pageParam,
            signal,
          }),
        signal,
        view,
      ),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
}

/**
 * متوسط تقييمها وعدده في الشهر الحالي؛ الرد بيحدد لوحده لو العمود مخفي (HIDDEN).
 *
 * @param context مين بيفتح الشاشة
 * @param view رقم النافذة ومعالج الرفض
 * @param enabled false على جهاز الاستقبال: المسار شخصي بس فمفيش طلب
 * @returns استعلام ملخص التقييم
 */
export function useRatingSummary(context: WorkContext, view: PrivateViewAccess, enabled: boolean) {
  return useQuery({
    ...PRIVATE_READ,
    enabled,
    queryKey: ['my-work', context.identity, 'rating-summary'],
    queryFn: ({ signal }) => guarded(() => workCalls.ratingSummary(signal), signal, view),
  });
}

/**
 * إكراميات الشهر حسب الطريقة؛ لو العمود مخفي الرد HIDDEN ومفيش بلوك.
 *
 * @param context مين بيفتح الشاشة
 * @param month الشهر المطلوب أو undefined للحالي
 * @param view رقم النافذة ومعالج الرفض
 * @returns استعلام الإكراميات
 */
export function useWorkTips(
  context: WorkContext,
  month: string | undefined,
  view: PrivateViewAccess,
) {
  return useQuery({
    ...PRIVATE_READ,
    queryKey: ['my-work', context.identity, 'tips', month ?? 'current'],
    queryFn: ({ signal }) =>
      guarded(
        () => workCalls.tips({ mode: context.mode, month, windowId: view.windowId, signal }),
        signal,
        view,
      ),
  });
}
