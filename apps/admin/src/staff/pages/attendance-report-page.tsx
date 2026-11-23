'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { localDate, t, type Locale } from '@pospay/i18n';
import { DataTableFrame, PageHeader, PageShell } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useAttendanceReport, type AttendanceReportScope } from '../api/use-attendance-report';
import { boardAccessLost } from '../model/attendance-board-display';
import { AttendanceReportDownload } from '../ui/attendance-report-download';
import { AttendanceReportFilterBar } from '../ui/attendance-report-filter-bar';
import { AttendanceReportResults } from '../ui/attendance-report-results';
import { useAttendanceReportSorting } from '../ui/use-attendance-report-sorting';

type Props = {
  scope: AttendanceReportScope;
  branches: WorkspaceBranch[];
  allowAllBranches: boolean;
  timezone: string;
  onBranch: (branchId: string) => void;
};
function reportBranchName(branches: WorkspaceBranch[], branchId: string, locale: Locale) {
  const branch = branches.find((entry) => entry.id === branchId);
  return branch && (locale === 'ar' ? (branch.name_ar ?? branch.name_en) : branch.name_en);
}

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
  const branchName = reportBranchName(branches, selected.branchId, locale);
  const resetKey = `${selected.branchId}:${month}`;
  const { sorting, onSortingChange } = useAttendanceReportSorting(visible ? resetKey : null);
  return (
    <PageShell layout="list">
      <PageHeader
        title={t(locale, 'attendanceReport.title')}
        action={
          <AttendanceReportDownload
            key={resetKey}
            scope={selected}
            month={month}
            branchName={branchName ?? 'all'}
            disabled={!visible}
          />
        }
      />
      <DataTableFrame
        stacked
        filters={
          <AttendanceReportFilterBar
            scope={selected}
            month={month}
            branches={branches}
            allowAllBranches={allowAllBranches}
            sorting={sorting}
            onSortingChange={onSortingChange}
            sortDisabled={!visible || report.data?.rows.length === 0}
            onMonth={setMonth}
            onBranch={(branchId) => {
              setAll(branchId === 'all');
              if (branchId !== 'all') onBranch(branchId);
            }}
          />
        }
      >
        <AttendanceReportResults
          report={report}
          visible={Boolean(visible)}
          resetKey={resetKey}
          sorting={sorting}
          onSortingChange={onSortingChange}
        />
      </DataTableFrame>
    </PageShell>
  );
}
