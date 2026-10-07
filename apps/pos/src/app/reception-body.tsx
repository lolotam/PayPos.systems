import { t } from '@pospay/i18n';
import { EmptyState, CircleAlert } from '@pospay/ui';
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
  const locale = useLocale();
  const operator = useStaffLogin();
  return (
    <div className="mx-auto grid w-full max-w-6xl items-start gap-12 lg:grid-cols-2">
      <StaffLoginScreen />
      <AttendanceHome branchId={branchId} onRejected={retry} />
      {operator.authenticatedSession ? (
        <ClockByCardScreen onRejected={retry} />
      ) : (
        <EmptyState
          role="status"
          tone="warning"
          icon={<CircleAlert />}
          title={t(locale, 'pos.cardSignedOut')}
        />
      )}
    </div>
  );
}
