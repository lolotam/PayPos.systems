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
  const message = enrolRefusal(state.errorCode);
  const locked =
    message === 'errors.PASSKEY_DEVICE_TAKEN' || message === 'errors.PASSKEY_OTHER_DEVICE';
  return (
    <div className="grid gap-6">
      {state.binding ? (
        <p>{t(locale, state.binding.bound ? 'personalStaff.bound' : 'personalStaff.unbound')}</p>
      ) : null}
      {state.binding?.bound === false ? (
        <Button size="touch" disabled={state.pending || locked} onClick={() => void state.enrol()}>
          {t(locale, 'personalStaff.enrol')}
        </Button>
      ) : null}
      {state.binding?.bound === true ? <ClockAttendanceScreen /> : null}
      {state.loading ? <p role="status">{t(locale, 'personalStaff.loading')}</p> : null}
      {state.error ? <p role="alert">{t(locale, message)}</p> : null}
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

function enrolRefusal(code: string | null) {
  if (code === 'PASSKEY_DEVICE_TAKEN') return 'errors.PASSKEY_DEVICE_TAKEN' as const;
  if (code === 'PASSKEY_OTHER_DEVICE') return 'errors.PASSKEY_OTHER_DEVICE' as const;
  if (code === 'INSTALLATION_STORAGE_BLOCKED') return 'personalAttendance.storageBlocked' as const;
  return 'errors.PASSKEY_INVALID' as const;
}
