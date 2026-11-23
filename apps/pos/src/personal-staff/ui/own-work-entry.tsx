import type { PersonalSessionContext } from '@pospay/contracts';
import { OwnWorkToggle } from './own-work-toggle';

/**
 * «شغلي» على موبايلها الشخصي: من غير PIN. تبديل الجلسة أو الدورة بيرجّعه مقفول.
 *
 * @param props.session الجلسة الشخصية الحية
 * @param props.epoch دورة الجلسة اللي بتتغير مع الخروج أو التبديل
 */
export function PersonalWorkEntry({
  session,
  epoch,
}: {
  session: PersonalSessionContext;
  epoch: number;
}) {
  const identity = `${epoch}:${session.user_id}:${session.employee_id}:${session.expires_at}`;
  return <OwnWorkToggle key={identity} context={{ mode: 'personal', identity }} />;
}
