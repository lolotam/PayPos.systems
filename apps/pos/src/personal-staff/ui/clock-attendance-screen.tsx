import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useClockAttendance } from '../api/use-clock-attendance';
import { AttendanceCamera } from './attendance-camera';

export function ClockAttendanceScreen() {
  const locale = useLocale();
  const state = useClockAttendance();
  const refusal = phoneRefusal(state.errorCode, locale);
  return (
    <section className="grid gap-4" aria-label={t(locale, 'personalAttendance.title')}>
      <h2 className="text-xl font-semibold">{t(locale, 'personalAttendance.title')}</h2>
      {state.scanning ? (
        <AttendanceCamera scanned={state.scanned} failed={state.failed} stop={state.stop} />
      ) : (
        <Button size="touch" disabled={state.pending || refusal !== null} onClick={state.start}>
          {t(locale, 'personalAttendance.scan')}
        </Button>
      )}
      {state.pending ? <p role="status">{t(locale, 'personalAttendance.pending')}</p> : null}
      {state.error ? <p role="alert">{refusal ?? t(locale, 'personalAttendance.failed')}</p> : null}
      {state.result ? (
        <div role="status" className="grid gap-2">
          <p>
            {t(
              locale,
              state.result.operation === 'CLOCK_IN'
                ? 'personalAttendance.clockedIn'
                : 'personalAttendance.clockedOut',
            )}
          </p>
          {state.result.exceptions.map((exception) => (
            <p key={exception}>
              {t(
                locale,
                exception === 'NONE'
                  ? 'personalAttendance.noLocation'
                  : 'personalAttendance.outOfRange',
              )}
            </p>
          ))}
          {state.result.missed_session_id ? (
            <p>{t(locale, 'personalAttendance.missedOut')}</p>
          ) : null}
          {state.result.late_minutes > 0 ? (
            <p>
              {t(locale, 'personalAttendance.late')}: {state.result.late_minutes}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function phoneRefusal(code: string | null, locale: Locale): string | null {
  if (code === 'ATTENDANCE_DEVICE_LOCKED' || code === 'PASSKEY_DEVICE_TAKEN')
    return t(locale, 'errors.ATTENDANCE_DEVICE_LOCKED');
  if (code === 'ATTENDANCE_DEVICE_NOT_ENROLLED' || code === 'PASSKEY_OTHER_DEVICE')
    return t(locale, 'errors.ATTENDANCE_DEVICE_NOT_ENROLLED');
  return null;
}
