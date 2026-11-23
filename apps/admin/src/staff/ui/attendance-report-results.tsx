'use client';
import type { AttendanceMonthlyReport } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import type { SortingState, Updater } from '@tanstack/react-table';
import { useLocale } from '@/shared/locale/locale-context';
import { AttendanceReportFeedback } from './attendance-report-feedback';
import { AttendanceReportTable } from './attendance-report-table';

/** محتوى كرت التقرير الشهري: رسالة التحميل أو الخطأ، ثم تنبيه صيغة الساعات والجدول إذا ظهرت البيانات. */
export function AttendanceReportResults({
  report,
  visible,
  resetKey,
  sorting,
  onSortingChange,
}: {
  report: {
    data: AttendanceMonthlyReport | undefined;
    error: unknown;
    isPending: boolean;
    isFetching: boolean;
    refetch: () => unknown;
  };
  visible: boolean;
  resetKey: string;
  sorting: SortingState;
  onSortingChange: (updater: Updater<SortingState>) => void;
}) {
  const locale = useLocale();
  return (
    <>
      <div className="p-4 empty:hidden">
        <AttendanceReportFeedback
          error={report.error}
          hasData={visible}
          loading={report.isPending}
          fetching={report.isFetching}
          onRetry={() => {
            void report.refetch();
          }}
        />
      </div>
      {visible && report.data ? (
        <>
          <p className="p-4 text-sm text-muted-foreground">
            {t(locale, 'attendanceReport.hoursFormat')}
          </p>
          <AttendanceReportTable
            key={resetKey}
            rows={report.data.rows}
            sorting={sorting}
            onSortingChange={onSortingChange}
          />
        </>
      ) : null}
    </>
  );
}
