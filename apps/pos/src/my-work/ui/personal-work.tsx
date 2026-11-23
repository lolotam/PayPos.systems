import { useQueryClient, type UseInfiniteQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import type { OwnServiceLines } from '@pospay/contracts';
import { useRatingSummary, useWorkTips } from '../api/use-my-work';
import { usePersonalLines } from '../api/use-personal-lines';
import { type LinesView, PENDING_LINES } from '../model/private-window-state';
import type { WorkContext } from '../model/work-context';
import { monthOutOfRange, sessionEnded } from '../model/work-error';
import { MyWorkCards } from './my-work-cards';

type LinesQuery = UseInfiniteQueryResult<{ pages: OwnServiceLines[] }, Error>;

function toLinesView(query: LinesQuery, deniedError: unknown): LinesView {
  // رفض الصلاحية على أي صفحة بيخفي كل الصفوف المحمّلة ويعرض حالة «ممنوع» نفسها، مش خطأ بإعادة محاولة.
  if (deniedError !== undefined) return { ...PENDING_LINES, status: 'error', error: deniedError };
  // فشل صفحة إضافية: الصفحات المحمّلة تفضل ظاهرة، والخطأ يتعرض جنب زر التحميل مش بدل القائمة.
  const appendFailed = query.isError && query.isFetchNextPageError;
  return {
    status: query.isPending ? 'pending' : query.isError && !appendFailed ? 'error' : 'ready',
    pages: query.data?.pages ?? [],
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
  const clear = useCallback(() => {
    const queryKey = ['my-work', context.identity];
    void cache.cancelQueries({ queryKey });
    cache.removeQueries({ queryKey });
  }, [cache, context.identity]);
  useEffect(() => clear, [clear]);
  const onRefused = (error: unknown) => {
    if (!sessionEnded(error)) return;
    clear();
    onLeave();
  };
  // undefined = الشهر الحالي زي ما السيرفر بيحدده؛ المتصفح ما بيحسبوش من ساعته.
  const [month, setMonth] = useState<string>();
  const [home, setHome] = useState<string>();
  const { lines, deniedError, resetDenied } = usePersonalLines(context, month, onRefused);
  const serverMonth = lines.data?.pages[0]?.month;
  // بعد الرفض الصفحات اتمسحت من الكاش، فآخر شهر معروف بيفضل على الشاشة عشان التنقل بين الشهور يفضل شغال.
  const shown = month ?? serverMonth ?? (deniedError === undefined ? undefined : home);
  // الإكراميات بتتطلب بالشهر المعروض (شهر أول صفحة خدمات لو مفيش شهر صريح) فمتبانش تحت شهر غير شهرها.
  const tips = useWorkTips(context, shown, onRefused);
  const rating = useRatingSummary(context, onRefused);
  if (month === undefined && serverMonth !== undefined && home !== serverMonth)
    setHome(serverMonth);
  return (
    <MyWorkCards
      month={shown}
      home={home}
      lines={toLinesView(lines, deniedError)}
      tips={tips.data?.month === shown ? tips.data : undefined}
      tipsFailed={tips.isError && !monthOutOfRange(tips.error)}
      onRetryTips={() => void tips.refetch()}
      rating={rating.data}
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
