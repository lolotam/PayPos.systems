import type { StaffSessionContext } from '@pospay/contracts';
import type { AttendanceContext } from '@/my-attendance/model/attendance-context';
import { OwnAttendanceToggle } from './own-attendance-toggle';

/**
 * «حضوري» على جهاز الاستقبال: الشاشة بتطلب الـ PIN الأول. تبديل المشغّلة بيغيّر الهوية فبيتقفل
 * وبيرجع لخطوة الـ PIN.
 *
 * @param props.session جلسة المشغّلة على الجهاز
 * @param props.epoch دورة جلسة المشغّلة
 * @param props.timeZone توقيت فرع الجهاز
 */
export function ReceptionAttendanceEntry({
  session,
  epoch,
  timeZone,
}: {
  session: StaffSessionContext;
  epoch: number;
  timeZone: string | undefined;
}) {
  const identity = `${epoch}:${session.user_id}:${session.device_id}:${session.expires_at}`;
  const context: AttendanceContext = { mode: 'reception', identity };
  return <OwnAttendanceToggle key={identity} context={context} timeZone={timeZone} />;
}
