import { monthOutOfRange } from '@/private-view/errors';
import { usePrivateViewData } from '@/private-view/use-private-view';
import type { AttendanceWindowController } from '../api/attendance-window-controller';
import { AttendanceMonth } from './attendance-month';

/**
 * كروت «حضوري» للنافذة المفتوحة على جهاز الاستقبال. المكوّن الوحيد اللي بيقرا بياناتها، وبيتفك مع أي قفل،
 * فمفيش مكوّن دائم بيحتفظ بلقطة فيها جلساتها بعد الرجوع لخطوة الـ PIN.
 *
 * @param props.controller متحكم النافذة
 * @param props.onMonth تغيير الشهر
 * @param props.onRetry إعادة المحاولة
 * @param props.timeZone توقيت النشاط
 */
export function ReceptionOpenAttendance({
  controller,
  onMonth,
  onRetry,
  timeZone,
}: {
  controller: AttendanceWindowController;
  onMonth: (month: string | undefined) => void;
  onRetry: () => void;
  timeZone: string | undefined;
}) {
  const data = usePrivateViewData(controller);
  if (data === null) return null;
  const shown = data.month ?? data.home;
  return (
    <AttendanceMonth
      month={shown}
      home={data.home}
      sessions={data.sessions}
      status={data.status}
      error={data.error}
      timeZone={timeZone}
      canGoBack={shown !== undefined && data.status !== 'pending' && !monthOutOfRange(data.error)}
      canGoForward={shown !== undefined && data.home !== undefined && shown !== data.home}
      onMonth={onMonth}
      onRetry={onRetry}
    />
  );
}
