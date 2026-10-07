import { StaffLoginScreen } from '@/staff-login/ui/staff-login-screen';
import { useStaffLogin } from '@/staff-login/api/use-staff-login';
import { AttendanceHome } from '@/attendance/ui/attendance-home';
import { CardClockAvailability } from '@/attendance/ui/card-clock-availability';

export function ReceptionBody({
  branchId,
  retry,
}: {
  branchId: string;
  retry: () => Promise<void>;
}) {
  const operator = useStaffLogin();
  return (
    <div className="mx-auto grid w-full max-w-6xl items-start gap-12 lg:grid-cols-2">
      <StaffLoginScreen />
      <AttendanceHome branchId={branchId} onRejected={retry} />
      <CardClockAvailability
        online={operator.online}
        signedIn={operator.authenticatedSession !== null}
        retry={retry}
      />
    </div>
  );
}
