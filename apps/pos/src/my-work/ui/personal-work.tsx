import { useQueryClient, type UseInfiniteQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import type { OwnServiceLines } from '@pospay/contracts';
import { useMountScope } from '../api/use-mount-scope';
import { usePersonalLines } from '../api/use-personal-lines';
import { usePersonalRating, usePersonalTips } from '../api/use-personal-reads';
import { type LinesView, PENDING_LINES } from '../model/private-window-state';
import type { WorkContext } from '../model/work-context';
import { monthOutOfRange, sessionEnded } from '../model/work-error';
import { MyWorkCards } from './my-work-cards';

type LinesQuery = UseInfiniteQueryResult<{ pages: OwnServiceLines[] }, Error>;

function toLinesView(query: LinesQuery, deniedError: unknown, proven: boolean): LinesView {
  // رفض الصلاحية على أي صفحة بيخفي كل الصفوف المحمّلة ويعرض حالة «ممنوع» نفسها، مش خطأ بإعادة محاولة.
  if (deniedError !== undefined) return { ...PENDING_LINES, status: 'error', error: deniedError };
  // صفحات الكاش من زيارة سابقة ما تتعرضش قبل ما السيرفر يرد بنجاح في الزيارة دي: لحد كده الشاشة بتحمّل.
  const waiting = query.isPending || (!proven && !query.isError);
  // فشل صفحة إضافية: الصفحات المحمّلة تفضل ظاهرة، والخطأ يتعرض جنب زر التحميل مش بدل القائمة.
  const appendFailed = proven && query.isError && query.isFetchNextPageError;
  return {
    status: waiting ? 'pending' : query.isError && !appendFailed ? 'error' : 'ready',
    pages: proven ? (query.data?.pages ?? []) : [],
    error: query.error,
    fetchingMore: query.isFetchingNextPage,
    moreError: appendFailed && !query.isFetchingNextPage ? query.error : undefined,
  };
}

/**
 * «شغلي» على موبايلها الشخصي: من غير نافذة ولا PIN، والقراءات بـ react-query بجلسة الكوكي. أي 401
 * بيمسح الكاش ويقفل الشاشة، والكاش بيتمسح كمان لما الشاشة تتفك.
 *
 * @param props.context مين بيفتح الشاشة وهويته
 * @param props.onLeave بتتنده لما الجلسة تتقفل (401)
 * @param props.estimateAllowed هل كارت التقدير مسموح؛ الافتراضي false من كل مدخل إنتاج لحد 57-5
 */
export function PersonalWork({
  context,
  onLeave,
  estimateAllowed,
}: {
  context: WorkContext;
  onLeave: () => void;
  estimateAllowed: boolean;
}) {
  const cache = useQueryClient();
  // كل تركيب للشاشة ليه مفاتيحه، فزيارتان على نفس الـ client ما بيتشاركوش في كاش ولا طلب شغال.
  const scope = useMountScope(context.identity);
  const clear = useCallback(
    (queryKey: readonly unknown[]) => {
      void cache.cancelQueries({ queryKey });
      cache.removeQueries({ queryKey });
    },
    [cache],
  );
  useEffect(() => () => clear(scope), [clear, scope]);
  const onRefused = (error: unknown) => {
    if (!sessionEnded(error)) return;
    // انتهاء الجلسة بيمسح بيانات الهوية كلها، مش بس زيارتي.
    clear(['my-work', context.identity]);
    onLeave();
  };
  // undefined = الشهر الحالي زي ما السيرفر بيحدده؛ المتصفح ما بيحسبوش من ساعته.
  const [month, setMonth] = useState<string>();
  const [home, setHome] = useState<string>();
  const { lines, proven, deniedError, resetDenied } = usePersonalLines(
    context,
    scope,
    month,
    onRefused,
  );
  // شهر السيرفر بيتاخد من قراءة اتثبتت في الزيارة دي بس، مش من كاش قديم، عشان الإكراميات ما تتطلبش بشهر قديم.
  const serverMonth = proven ? lines.data?.pages[0]?.month : undefined;
  // بعد الرفض الصفحات اتمسحت من الكاش، فآخر شهر معروف بيفضل على الشاشة عشان التنقل بين الشهور يفضل شغال.
  const shown = month ?? serverMonth ?? (deniedError === undefined ? undefined : home);
  // الإكراميات بتتطلب بالشهر المعروض (شهر أول صفحة خدمات لو مفيش شهر صريح) فمتبانش تحت شهر غير شهرها.
  const tips = usePersonalTips(context, scope, shown, onRefused);
  const rating = usePersonalRating(context, scope, onRefused);
  if (month === undefined && serverMonth !== undefined && home !== serverMonth)
    setHome(serverMonth);
  return (
    <MyWorkCards
      month={shown}
      home={home}
      lines={toLinesView(lines, deniedError, proven)}
      tips={tips.data?.month === shown ? tips.data : undefined}
      tipsFailed={tips.query.isError && !monthOutOfRange(tips.query.error)}
      onRetryTips={() => void tips.query.refetch()}
      rating={rating}
      estimateAllowed={estimateAllowed}
      onMonth={(next) => {
        resetDenied();
        setMonth(next);
      }}
      onRetry={() => void lines.refetch()}
      onLoadMore={() => void lines.fetchNextPage()}
    />
  );
}
