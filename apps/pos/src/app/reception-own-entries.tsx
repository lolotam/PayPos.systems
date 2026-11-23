import type { StaffSessionContext } from '@pospay/contracts';
import { ReceptionWorkEntry } from '@/personal-staff/ui/reception-work-entry';
import { OwnLeaveEntry } from './own-leave-entry';

/**
 * «إجازاتي» و«شغلي» تحت جلسة المشغّلة على جهاز الاستقبال؛ من غير ما الجلسة تطابق الجهاز مفيش حاجة.
 *
 * @param props.session جلسة المشغّلة
 * @param props.epoch دورة جلستها
 * @param props.branchId الفرع المربوط بالجهاز
 * @param props.deviceId الجهاز المربوط
 * @param props.zone توقيت الفرع لو معروف
 */
export function ReceptionOwnEntries({
  session,
  epoch,
  branchId,
  deviceId,
  zone,
}: {
  session: StaffSessionContext;
  epoch: number;
  branchId: string;
  deviceId: string | undefined;
  zone: { id: string; timezone: string } | null;
}) {
  if (!deviceId || session.branch_id !== branchId || session.device_id !== deviceId) return null;
  const timezone = zone?.id === branchId ? zone.timezone : undefined;
  return (
    <>
      <OwnLeaveEntry
        context={{
          mode: 'reception',
          ...session,
          sessionEpoch: epoch,
          ...(timezone ? { timezone } : {}),
        }}
      />
      <ReceptionWorkEntry session={session} epoch={epoch} />
    </>
  );
}
