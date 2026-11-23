'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useAttendanceReportCsv } from '../api/use-attendance-report-csv';
import type { AttendanceReportScope } from '../api/use-attendance-report';

/** زر التنزيل في ترويسة الصفحة؛ حالة التنزيل وخطؤه يعرضهما AttendanceReportDownloadMessages تحت التصفية. */
export function AttendanceReportDownload({
  scope,
  month,
  branchName,
  disabled,
}: {
  scope: AttendanceReportScope;
  month: string;
  branchName: string;
  disabled: boolean;
}) {
  const locale = useLocale();
  const download = useAttendanceReportCsv(scope, month, branchName);
  return (
    <Button
      disabled={disabled || download.isPending}
      aria-busy={download.isPending}
      onClick={() => download.mutate()}
    >
      {t(locale, download.isPending ? 'attendanceReport.downloading' : 'attendanceReport.download')}
    </Button>
  );
}
