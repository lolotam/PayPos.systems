import { t } from '@pospay/i18n';
import { CircleAlert, EmptyState, WifiOff } from '@pospay/ui';
import { StaffLoginScreen } from '@/staff-login/ui/staff-login-screen';
import { useStaffLogin } from '@/staff-login/api/use-staff-login';
import { AttendanceHome } from '@/attendance/ui/attendance-home';
import { ClockByCardScreen } from '@/attendance/ui/clock-by-card-screen';
import { useLocale } from '@/shared/locale/locale-context';

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

function CardClockAvailability({
  online,
  signedIn,
  retry,
}: {
  online: boolean;
  signedIn: boolean;
  retry: () => Promise<void>;
}) {
  const locale = useLocale();
  if (!online) {
    return (
      <EmptyState
        role="status"
        tone="warning"
        icon={<WifiOff />}
        title={t(locale, 'pos.cardOffline')}
      />
    );
  }
  if (!signedIn) {
    return (
      <EmptyState
        role="status"
        tone="warning"
        icon={<CircleAlert />}
        title={t(locale, 'pos.cardSignedOut')}
      />
    );
  }
  return <ClockByCardScreen onRejected={retry} />;
}
