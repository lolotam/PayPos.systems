import { PrivateViewPinForm } from '@/shared/private-view/pin-form';
import { useAttendanceWindow } from '../api/use-attendance-window';
import { ReceptionOpenAttendance } from './reception-open-attendance';

/**
 * «حضوري» على جهاز الاستقبال: خطوة الـ PIN، وبعدها البيانات من متحكم النافذة بس (من غير كاش react-query).
 * المتحكم بيتركّب هنا قبل الـ PIN، فأي خروج من الواجهة وقت الفتح أو بعده بيقفل ويرجّع خطوة الـ PIN.
 * حاوية البيانات بتتسجّل في المتحكم عشان تتخفّى في نفس الحدث قبل ما React يطبّق القفل.
 *
 * @param props.onLeave بتتنده لما الجلسة تتقفل (401)
 * @param props.timeZone توقيت النشاط (توقيت فرع الجهاز)
 */
export function ReceptionAttendance({
  onLeave,
  timeZone,
}: {
  onLeave: () => void;
  timeZone: string | undefined;
}) {
  const { state, controller, attachRoot, submitPin, stepMonth, retry } = useAttendanceWindow({ onLeave });
  if (state.phase === 'leave') return null;
  if (state.phase !== 'open')
    return (
      <PrivateViewPinForm
        key={state.epoch}
        section="myAttendance"
        problem={state.phase === 'pin' ? state.problem : null}
        pending={state.phase === 'opening'}
        waiting={state.phase === 'pin' && state.waiting}
        onSubmit={(pin) => void submitPin(pin, state.epoch)}
      />
    );
  return (
    <div ref={attachRoot}>
      <ReceptionOpenAttendance
        controller={controller}
        onMonth={stepMonth}
        onRetry={retry}
        timeZone={timeZone}
      />
    </div>
  );
}
