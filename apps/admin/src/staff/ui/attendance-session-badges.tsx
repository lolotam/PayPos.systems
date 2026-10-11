'use client';
import type { AttendanceBoard } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
import Link from 'next/link';
import { useLocale } from '@/shared/locale/locale-context';
export function AttendanceSessionBadges({ row }: { row: AttendanceBoard['sessions'][number] }) {
  const locale = useLocale();
  return (
    <div className="flex flex-wrap gap-1">
      {row.open_exceptions.map((exception) => (
        <Link
          key={exception.id}
          href="/staff/attendance-exceptions"
          className="rounded focus-visible:outline focus-visible:outline-2"
        >
          <Badge variant="warning">{t(locale, `attendanceBoard.${exception.kind}`)}</Badge>
        </Link>
      ))}
      {row.corrected ? (
        <Badge variant="info">{t(locale, 'attendanceBoard.corrected')}</Badge>
      ) : null}
    </div>
  );
}
