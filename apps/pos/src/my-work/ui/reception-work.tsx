import { type PinFormTexts, PrivateViewPinForm } from '@/private-view/pin-form';
import { usePrivateWindow } from '../api/use-private-window';
import { ReceptionOpenWork } from './reception-open-work';

/** نصوص خطوة الـ PIN من كتالوج «شغلي». */
const WORK_PIN_TEXTS = {
  title: 'myWork.pinTitle',
  label: 'myWork.pinLabel',
  submit: 'myWork.pinSubmit',
  invalid: 'myWork.pinInvalid',
  failed: 'myWork.pinFailed',
  refused: 'myWork.refused',
  waiting: 'myWork.pinWaiting',
} as const satisfies PinFormTexts;

/**
 * «شغلي» على جهاز الاستقبال: خطوة الـ PIN، وبعدها البيانات من متحكم النافذة بس (من غير كاش react-query).
 * المتحكم بيتركّب هنا قبل الـ PIN، فأي خروج من الواجهة وقت الفتح أو بعده بيقفل ويرجّع خطوة الـ PIN.
 * حاوية البيانات بتتسجّل في المتحكم عشان تتخفّى في نفس الحدث قبل ما React يطبّق القفل، ومالهاش class عرض.
 * المكوّن ده دائم فبيشترك في هيكل الحالة بس؛ البيانات نفسها بيقراها `ReceptionOpenWork` اللي بيتفك مع القفل.
 * مفيش كارت تقييم هنا (AC-3-4).
 *
 * @param props.onLeave بتتنده لما الجلسة تتقفل (401)
 */
export function ReceptionWork({ onLeave }: { onLeave: () => void }) {
  const { state, controller, attachRoot, submitPin, stepMonth, retry, retryTips, loadMore } =
    usePrivateWindow({ onLeave });
  if (state.phase === 'leave') return null;
  if (state.phase !== 'open')
    return (
      <PrivateViewPinForm
        key={state.epoch}
        texts={WORK_PIN_TEXTS}
        problem={state.phase === 'pin' ? state.problem : null}
        pending={state.phase === 'opening'}
        waiting={state.phase === 'pin' && state.waiting}
        onSubmit={(pin) => void submitPin(pin, state.epoch)}
      />
    );
  return (
    <div ref={attachRoot}>
      <ReceptionOpenWork
        controller={controller}
        onMonth={stepMonth}
        onRetry={retry}
        onRetryTips={retryTips}
        onLoadMore={loadMore}
      />
    </div>
  );
}
