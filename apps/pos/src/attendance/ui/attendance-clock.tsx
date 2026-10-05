import { formatTime, t } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';

export function AttendanceClock({ now, timeZone }: { now: Date; timeZone: string }) {
  const locale = useLocale();
  return (
    <time
      className="text-4xl font-bold tabular-nums sm:text-5xl"
      dateTime={now.toISOString()}
      aria-label={t(locale, 'pos.attendanceClockLabel')}
    >
      {formatTime(now, { locale, timeZone })}
    </time>
  );
}
