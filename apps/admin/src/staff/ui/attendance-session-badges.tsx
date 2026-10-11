'use client';
import type { AttendanceBoard } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
export function AttendanceSessionBadges({ row }: { row: AttendanceBoard['sessions'][number] }) {
  const locale = useLocale();
  return (
    <div className="flex flex-wrap gap-1">
      {row.open_exceptions.map((exception) => (
        <Badge key={exception.id} variant="warning">
          {t(locale, `attendanceBoard.${exception.kind}`)}
        </Badge>
      ))}
      {row.corrected ? (
        <Badge variant="info">{t(locale, 'attendanceBoard.corrected')}</Badge>
      ) : null}
    </div>
  );
}
