'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { localDate, t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useAttendanceReport, type AttendanceReportScope } from '../api/use-attendance-report';
import { boardAccessLost } from '../model/attendance-board-display';
import { AttendanceReportDownload } from '../ui/attendance-report-download';
import { AttendanceReportFeedback } from '../ui/attendance-report-feedback';
import { AttendanceReportFilters } from '../ui/attendance-report-filters';
import { AttendanceReportTable } from '../ui/attendance-report-table';

type Props = {
  scope: AttendanceReportScope;
  branches: WorkspaceBranch[];
  allowAllBranches: boolean;
  timezone: string;
  onBranch: (branchId: string) => void;
};
export function AttendanceReportPage({
  scope,
  branches,
  allowAllBranches,
  timezone,
  onBranch,
}: Props) {
  const locale = useLocale();
  const [month, setMonth] = useState(() => localDate(new Date(), timezone).slice(0, 7));
  const [all, setAll] = useState(false);
  const selected = { ...scope, branchId: all && allowAllBranches ? 'all' : scope.branchId };
  const report = useAttendanceReport(selected, month);
  const visible = report.data && !boardAccessLost(report.error);
  const branch = branches.find((branch) => branch.id === selected.branchId);
  const branchName =
    branch && (locale === 'ar' ? (branch.name_ar ?? branch.name_en) : branch.name_en);
  return (
    <section className="flex min-w-0 flex-col gap-6 text-start">
      <PageHeader title={t(locale, 'attendanceReport.title')} />
      <AttendanceReportFilters
        branches={branches}
        allowAllBranches={allowAllBranches}
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
        branchName={branchName ?? 'all'}
        disabled={!visible}
      />
      <AttendanceReportFeedback
        error={report.error}
        hasData={Boolean(visible)}
        loading={report.isPending}
        fetching={report.isFetching}
        onRetry={() => {
          void report.refetch();
        }}
      />
      {visible ? (
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
