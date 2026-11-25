import type { PrivateWindowController } from '../api/private-window-controller';
import { usePrivateWindowData } from '../api/use-private-window';
import { shownMonth } from '../model/private-window-state';
import { MyWorkCards } from './my-work-cards';

/**
 * كروت «شغلي» للنافذة المفتوحة على جهاز الاستقبال. المكوّن الوحيد اللي بيقرا بياناتها، وبيتفك مع أي قفل،
 * فمفيش مكوّن دائم بيحتفظ بلقطة فيها صفحاتها بعد الرجوع لخطوة الـ PIN.
 *
 * @param props.controller متحكم النافذة
 * @param props.onMonth تغيير الشهر
 * @param props.onRetry إعادة المحاولة
 * @param props.onRetryTips إعادة قراءة الإكراميات بس
 * @param props.onLoadMore تحميل الصفحة التالية
 */
export function ReceptionOpenWork({
  controller,
  onMonth,
  onRetry,
  onRetryTips,
  onLoadMore,
}: {
  controller: PrivateWindowController;
  onMonth: (month: string | undefined) => void;
  onRetry: () => void;
  onRetryTips: () => void;
  onLoadMore: () => void;
}) {
  const data = usePrivateWindowData(controller);
  if (data === null) return null;
  return (
    <MyWorkCards
      month={shownMonth(data)}
      home={data.home}
      lines={data.lines}
      tips={data.tips}
      tipsFailed={data.tipsFailed}
      rating={undefined}
      estimate={data.estimate}
      onMonth={onMonth}
      onRetry={onRetry}
      onRetryTips={onRetryTips}
      onLoadMore={onLoadMore}
    />
  );
}
