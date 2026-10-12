'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { attendanceReportError } from '../model/attendance-report-display';

export function AttendanceReportFeedback({
  error,
  hasData,
  loading,
  fetching,
  onRetry,
}: {
  error: unknown;
  hasData: boolean;
  loading: boolean;
  fetching: boolean;
  onRetry: () => void;
}) {
  const locale = useLocale();
  if (loading) return <p role="status">{t(locale, 'admin.loading')}</p>;
  if (!error) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
      <p>
        {hasData
          ? t(locale, 'attendanceReport.refreshError')
          : attendanceReportError(error, locale)}
      </p>
      <Button variant="outline" onClick={onRetry} disabled={fetching}>
        {t(locale, 'attendanceReport.retry')}
      </Button>
    </div>
  );
}
