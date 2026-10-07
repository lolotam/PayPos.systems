import { t } from '@pospay/i18n';
import { CircleAlert, EmptyState } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';
import type { CardClockOutcome } from '../api/clock-by-card';

const rejectionMessages = {
  refused: 'pos.cardForbidden',
  'signed-out': 'pos.cardSignedOut',
  invalid: 'pos.cardInvalid',
  unavailable: 'pos.networkError',
} as const;

/** نتيجة المسح كما تعرضها الاستقبال: قبول أو رفض، بلا تفاصيل عن موظف أو كارت. */
export function ClockByCardResult({ outcome }: { outcome: CardClockOutcome }) {
  const locale = useLocale();
  if (outcome.kind !== 'accepted') {
    if (outcome.kind === 'offline') return null;
    return (
      <EmptyState
        role="alert"
        tone={outcome.kind === 'signed-out' ? 'warning' : 'danger'}
        icon={<CircleAlert />}
        title={t(locale, rejectionMessages[outcome.kind])}
      />
    );
  }
  const result = outcome.result;
  return (
    <div role="status" className="grid gap-2">
      <p className="text-lg font-semibold">
        {t(
          locale,
          result.operation === 'CLOCK_IN'
            ? 'personalAttendance.clockedIn'
            : 'personalAttendance.clockedOut',
        )}
      </p>
      {result.exceptions.map((exception) => (
        <p key={exception}>
          {t(
            locale,
            exception === 'NONE'
              ? 'personalAttendance.noLocation'
              : 'personalAttendance.outOfRange',
          )}
        </p>
      ))}
      {result.missed_session_id ? <p>{t(locale, 'personalAttendance.missedOut')}</p> : null}
      {result.late_minutes > 0 ? (
        <p>
          {t(locale, 'personalAttendance.late')}: {result.late_minutes}
        </p>
      ) : null}
    </div>
  );
}
