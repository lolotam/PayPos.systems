import { ReceptionOwnEntries } from './reception-own-entries';
import { StaffLoginPanel } from '@/staff-login/ui/staff-login-panel';
import { useStaffLogin } from '@/staff-login/api/use-staff-login';
import { AttendanceHome } from '@/attendance/ui/attendance-home';
import { CardClockAvailability } from '@/attendance/ui/card-clock-availability';
import { DeviceDiscountApprovals } from '@/discount-approval/ui/device-discount-approvals';
import { useEffect, useRef, useState } from 'react';

function renderDeviceDiscountApprovals(
  branchId: string,
  operatorKey: string,
  onRejected: () => Promise<void>,
) {
  return (
    <div className="lg:col-span-2">
      <DeviceDiscountApprovals
        branchId={branchId}
        operatorKey={operatorKey}
        onRejected={onRejected}
      />
    </div>
  );
}

export function ReceptionBody({
  branchId,
  deviceId,
  retry,
  retryBinding = retry,
  bindingConfirmed,
}: {
  branchId: string;
  deviceId?: string | undefined;
  retry: () => Promise<void>;
  retryBinding?: () => Promise<void>;
  bindingConfirmed?: () => void;
}) {
  const operator = useStaffLogin();
  const [branchZone, setBranchZone] = useState<{ id: string; timezone: string } | null>(null);
  const session = operator.authenticatedSession;
  const operatorKey = `${operator.epoch}:${session?.user_id ?? 'none'}`;
  const mismatch =
    session !== null &&
    (!deviceId || session.branch_id !== branchId || session.device_id !== deviceId);
  const retried = useRef(false);
  useEffect(() => {
    if (session !== null && !mismatch) {
      retried.current = false;
      bindingConfirmed?.();
      return;
    }
    if (!mismatch || retried.current) return;
    retried.current = true;
    void retryBinding();
  }, [mismatch, retryBinding, session, bindingConfirmed]);
  return (
    <div className="mx-auto grid w-full max-w-6xl items-start gap-12 lg:grid-cols-2">
      <StaffLoginPanel
        login={operator}
        ownLeave={(session, epoch) => (
          <ReceptionOwnEntries
            session={session}
            epoch={epoch}
            branchId={branchId}
            deviceId={deviceId}
            zone={branchZone}
          />
        )}
      />
      <AttendanceHome branchId={branchId} onRejected={retry} onBranchTimezone={setBranchZone} />
      <CardClockAvailability
        online={operator.online}
        signedIn={operator.authenticatedSession !== null}
        retry={retry}
      />
      {renderDeviceDiscountApprovals(branchId, operatorKey, retry)}
    </div>
  );
}
