import { usePrivateWindow } from '../api/use-private-window';
import { shownMonth } from '../model/private-window-state';
import { MyWorkCards } from './my-work-cards';
import { PrivateViewPinForm } from './private-view-pin-form';

/**
 * «شغلي» على جهاز الاستقبال: خطوة الـ PIN، وبعدها البيانات من متحكم النافذة بس (من غير كاش react-query).
 * المتحكم بيتركّب هنا قبل الـ PIN، فأي خروج من الواجهة وقت الفتح أو بعده بيقفل ويرجّع خطوة الـ PIN.
 * حاوية البيانات بتتسجّل في المتحكم عشان تتخفّى في نفس الحدث قبل ما React يطبّق القفل، ومالهاش class عرض.
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
  const { state, attachRoot, submitPin, stepMonth, retry, loadMore } = usePrivateWindow({
    onLeave,
  });
  if (state.phase === 'leave') return null;
  if (state.phase !== 'open')
    return (
      <PrivateViewPinForm
        key={state.epoch}
        problem={state.phase === 'pin' ? state.problem : null}
        pending={state.phase === 'opening'}
        waiting={state.phase === 'pin' && state.waiting}
        onSubmit={(pin) => void submitPin(pin, state.epoch)}
      />
    );
  const { data } = state;
  return (
    <div ref={attachRoot}>
      <MyWorkCards
        month={shownMonth(data)}
        home={data.home}
        lines={data.lines}
        tips={data.tips}
        rating={undefined}
        estimateAllowed={estimateAllowed}
        onMonth={stepMonth}
        onRetry={retry}
        onLoadMore={loadMore}
      />
    </div>
  );
}
