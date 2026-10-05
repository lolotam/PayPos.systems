import { t } from '@pospay/i18n';
import { CircleAlert, EmptyState } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';
import type { CardClockOutcome } from '../api/clock-by-card';

/** نتيجة المسح كما تعرضها الاستقبال: قبول أو رفض، بلا تفاصيل عن موظف أو كارت. */
export function ClockByCardResult({ outcome }: { outcome: CardClockOutcome }) {
  const locale = useLocale();
  if (outcome.kind === 'refused')
    return (
      <EmptyState role="alert" tone="danger" icon={<CircleAlert />} title={t(locale, 'pos.cardForbidden')} />
    );
  if (outcome.kind === 'invalid')
    return (
      <EmptyState role="alert" tone="danger" icon={<CircleAlert />} title={t(locale, 'pos.cardInvalid')} />
    );
  if (outcome.kind === 'unavailable')
    return (
      <EmptyState role="alert" tone="danger" icon={<CircleAlert />} title={t(locale, 'pos.networkError')} />
    );
  if (outcome.kind !== 'accepted') return null;
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
