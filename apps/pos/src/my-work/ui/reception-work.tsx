import { usePrivateWindow } from '../api/use-private-window';
import { shownMonth } from '../model/private-window-state';
import { MyWorkCards } from './my-work-cards';
import { PrivateViewPinForm } from './private-view-pin-form';

/**
 * «شغلي» على جهاز الاستقبال: خطوة الـ PIN، وبعدها البيانات من متحكم النافذة بس (من غير كاش react-query).
 * المتحكم بيتركّب هنا قبل الـ PIN، فأي خروج من الواجهة وقت الفتح أو بعده بيقفل ويرجّع خطوة الـ PIN.
 * مفيش كارت تقييم هنا (AC-3-4).
 *
 * @param props.onLeave بتتنده لما الجلسة تتقفل (401)
 * @param props.estimateAllowed هل كارت التقدير مسموح؛ الافتراضي false من كل مدخل إنتاج لحد 57-5
 */
export function ReceptionWork({
  onLeave,
  estimateAllowed,
}: {
  onLeave: () => void;
  estimateAllowed: boolean;
}) {
  const view = usePrivateWindow({ onLeave });
  const { state } = view;
  if (state.phase === 'leave') return null;
  if (state.phase !== 'open')
    return (
      <PrivateViewPinForm
        problem={state.phase === 'pin' ? state.problem : null}
        pending={state.phase === 'opening'}
        onSubmit={view.submitPin}
      />
    );
  const { data } = state;
  return (
    <MyWorkCards
      month={shownMonth(data)}
      home={data.home}
      lines={data.lines}
      tips={data.tips}
      rating={undefined}
      estimateAllowed={estimateAllowed}
      onMonth={view.stepMonth}
      onRetry={view.retry}
      onLoadMore={view.loadMore}
    />
  );
}
