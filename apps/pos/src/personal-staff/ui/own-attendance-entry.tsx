import type { PersonalSessionContext } from '@pospay/contracts';
import type { AttendanceContext } from '@/my-attendance/model/attendance-context';
import { OwnAttendanceToggle } from './own-attendance-toggle';

/**
 * «حضوري» على موبايلها الشخصي: من غير PIN. تبديل الجلسة أو الدورة بيرجّعه مقفول.
 *
 * @param props.session الجلسة الشخصية الحية
 * @param props.epoch دورة الجلسة اللي بتتغير مع الخروج أو التبديل
 */
export function PersonalAttendanceEntry({
  session,
  epoch,
}: {
  session: PersonalSessionContext;
  epoch: number;
}) {
  const identity = `${epoch}:${session.user_id}:${session.employee_id}:${session.expires_at}`;
  const context: AttendanceContext = { mode: 'personal', identity };
  return <OwnAttendanceToggle key={identity} context={context} timeZone={undefined} />;
}
