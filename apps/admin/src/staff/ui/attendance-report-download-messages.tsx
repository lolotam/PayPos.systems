'use client';
import { t } from '@pospay/i18n';
import { useMutationState } from '@tanstack/react-query';
import { useLocale } from '@/shared/locale/locale-context';
import { attendanceReportCsvKey } from '../api/use-attendance-report-csv';
import type { AttendanceReportScope } from '../api/use-attendance-report';
import { attendanceReportError } from '../model/attendance-report-display';

/**
 * حالة تنزيل الـCSV وخطؤه من الكاش لا من مراقب ثانٍ: الزر في الترويسة هو الوحيد الذي يطلب.
 * يُركَّب بمفتاح الفرع والشهر كما يُركَّب الزر، فتبدأ كل تصفية بلا رسالة قديمة.
 */
export function AttendanceReportDownloadMessages({
  scope,
  month,
}: {
  scope: AttendanceReportScope;
  month: string;
}) {
  const locale = useLocale();
  const latest = useMutationState({
    filters: { mutationKey: attendanceReportCsvKey(scope, month), exact: true },
    select: (mutation) => ({ status: mutation.state.status, error: mutation.state.error }),
  }).at(-1);
  return (
    <>
      {latest?.status === 'pending' ? (
        <p role="status">{t(locale, 'attendanceReport.downloading')}</p>
      ) : null}
      {latest?.error ? <p role="alert">{attendanceReportError(latest.error, locale)}</p> : null}
    </>
  );
}
