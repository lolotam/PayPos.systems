'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useAttendanceReportCsv } from '../api/use-attendance-report-csv';
import type { AttendanceReportScope } from '../api/use-attendance-report';
import { attendanceReportError } from '../model/attendance-report-display';

export function AttendanceReportDownload({
  scope,
  month,
  disabled,
}: {
  scope: AttendanceReportScope;
  month: string;
  disabled: boolean;
}) {
  const locale = useLocale();
  const download = useAttendanceReportCsv(scope, month);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        disabled={disabled || download.isPending}
        aria-busy={download.isPending}
        onClick={() => download.mutate()}
      >
        {t(
          locale,
          download.isPending ? 'attendanceReport.downloading' : 'attendanceReport.download',
        )}
      </Button>
      {download.isPending ? <p role="status">{t(locale, 'attendanceReport.downloading')}</p> : null}
      {download.error ? <p role="alert">{attendanceReportError(download.error, locale)}</p> : null}
    </div>
  );
}
