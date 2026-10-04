import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useClockAttendance } from '../api/use-clock-attendance';
import { AttendanceCamera } from './attendance-camera';

export function ClockAttendanceScreen() {
  const locale = useLocale();
  const state = useClockAttendance();
  return (
    <section className="grid gap-4" aria-label={t(locale, 'personalAttendance.title')}>
      <h2 className="text-xl font-semibold">{t(locale, 'personalAttendance.title')}</h2>
      {state.scanning ? (
        <AttendanceCamera scanned={state.scanned} failed={state.failed} stop={state.stop} />
      ) : (
        <Button size="touch" disabled={state.pending} onClick={state.start}>
          {t(locale, 'personalAttendance.scan')}
        </Button>
      )}
      {state.pending ? <p role="status">{t(locale, 'personalAttendance.pending')}</p> : null}
      {state.error ? <p role="alert">{t(locale, 'personalAttendance.failed')}</p> : null}
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
