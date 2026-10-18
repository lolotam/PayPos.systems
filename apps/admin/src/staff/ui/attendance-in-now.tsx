'use client';
import type { AttendanceBoard } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Card, CardHeader, CardTitle, CardContent } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { boardTime, stillIn } from '../model/attendance-board-display';
import { displayEmployeeNumber } from '../model/employee-number-display';
import { AttendanceSourceBadge } from './attendance-source-badge';
export function AttendanceInNow({ board }: { board: AttendanceBoard }) {
  const locale = useLocale();
  const time = (instant: string | null) => boardTime(instant, locale, board.timezone);
  return (
    <section aria-labelledby="attendance-in-now" className="flex flex-col gap-3">
      <h2 id="attendance-in-now" className="text-lg font-semibold">
        {t(locale, 'attendanceBoard.inNow')}
      </h2>
      {board.in_now.length === 0 ? <p>{t(locale, 'attendanceBoard.emptyInNow')}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {board.in_now.map((row) => (
          <Card key={`${row.employee_id}:${row.clock_in}`}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-baseline gap-2">
                <span>{locale === 'ar' ? (row.name_ar ?? row.name_en) : row.name_en}</span>
                <span>{displayEmployeeNumber(row.employee_number)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <AttendanceSourceBadge source={row.source} />
              <dl className="grid gap-1">
                <dt>{t(locale, 'attendanceBoard.clockIn')}</dt>
                <dd>{time(row.clock_in)}</dd>
                <dt>{t(locale, 'attendanceBoard.stillIn')}</dt>
                <dd dir="ltr">{stillIn(row.clock_in, board.generated_at)}</dd>
                <dt>{t(locale, 'attendanceBoard.scheduledEnd')}</dt>
                <dd>{time(row.scheduled_end)}</dd>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
