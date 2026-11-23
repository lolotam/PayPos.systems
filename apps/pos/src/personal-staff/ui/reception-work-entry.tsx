import type { StaffSessionContext } from '@pospay/contracts';
import { OwnWorkToggle } from './own-work-toggle';

/**
 * «شغلي» على جهاز الاستقبال: الشاشة بتطلب الـ PIN الأول. تبديل المشغّلة بيغيّر الهوية فبيتقفل
 * وبيرجع لخطوة الـ PIN.
 *
 * @param props.session جلسة المشغّلة على الجهاز
 * @param props.epoch دورة جلسة المشغّلة
 */
export function ReceptionWorkEntry({
  session,
  epoch,
}: {
  session: StaffSessionContext;
  epoch: number;
}) {
  const identity = `${epoch}:${session.user_id}:${session.device_id}:${session.expires_at}`;
  return <OwnWorkToggle key={identity} context={{ mode: 'reception', identity }} />;
}
