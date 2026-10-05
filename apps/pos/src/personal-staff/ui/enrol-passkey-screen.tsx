import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useEnrolPasskey } from '../api/use-enrol-passkey';
import { ClockAttendanceScreen } from './clock-attendance-screen';

export function EnrolPasskeyScreen({
  employeeId,
  onSignOut,
}: {
  employeeId: string;
  onSignOut(): Promise<void>;
}) {
  const locale = useLocale();
  const state = useEnrolPasskey(employeeId);
  return (
    <div className="grid gap-6">
      {state.binding ? (
        <p>{t(locale, state.binding.bound ? 'personalStaff.bound' : 'personalStaff.unbound')}</p>
      ) : null}
      {state.binding?.bound === false ? (
        <Button size="touch" disabled={state.pending} onClick={() => void state.enrol()}>
          {t(locale, 'personalStaff.enrol')}
        </Button>
      ) : null}
      {state.binding?.bound === true ? <ClockAttendanceScreen /> : null}
      {state.loading ? <p role="status">{t(locale, 'personalStaff.loading')}</p> : null}
      {state.error ? <p role="alert">{t(locale, 'errors.PASSKEY_INVALID')}</p> : null}
      <Button
        size="touch"
        variant="outline"
        disabled={state.pending}
        onClick={() => void onSignOut().catch(() => undefined)}
      >
        {t(locale, 'personalStaff.signOut')}
      </Button>
    </div>
  );
}
