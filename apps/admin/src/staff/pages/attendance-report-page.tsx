'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { localDate, t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useAttendanceReport, type AttendanceReportScope } from '../api/use-attendance-report';
import { AttendanceReportDownload } from '../ui/attendance-report-download';
import { AttendanceReportFeedback } from '../ui/attendance-report-feedback';
import { AttendanceReportFilters } from '../ui/attendance-report-filters';
import { AttendanceReportTable } from '../ui/attendance-report-table';

export function AttendanceReportPage({
  scope,
  branches,
  timezone,
  onBranch,
}: {
  scope: AttendanceReportScope;
  branches: WorkspaceBranch[];
  timezone: string;
  onBranch: (branchId: string) => void;
}) {
  const locale = useLocale();
  const [month, setMonth] = useState(() => localDate(new Date(), timezone).slice(0, 7));
  const [all, setAll] = useState(false);
  const selected = { ...scope, branchId: all ? 'all' : scope.branchId };
  const report = useAttendanceReport(selected, month);
  return (
    <section className="flex min-w-0 flex-col gap-6 text-start">
      <PageHeader title={t(locale, 'attendanceReport.title')} />
      <AttendanceReportFilters
        branches={branches}
        branchId={selected.branchId}
        month={month}
        onMonth={setMonth}
        onBranch={(branchId) => {
          setAll(branchId === 'all');
          if (branchId !== 'all') onBranch(branchId);
        }}
      />
      <AttendanceReportDownload
        key={`${selected.branchId}:${month}`}
        scope={selected}
        month={month}
        disabled={report.isPending || report.isError}
      />
      <AttendanceReportFeedback
        error={report.error}
        loading={report.isPending}
        fetching={report.isFetching}
        onRetry={() => {
          void report.refetch();
        }}
      />
      {report.data && !report.isError ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t(locale, 'attendanceReport.hoursFormat')}
          </p>
          <AttendanceReportTable key={`${selected.branchId}:${month}`} rows={report.data.rows} />
        </>
      ) : null}
    </section>
  );
}
