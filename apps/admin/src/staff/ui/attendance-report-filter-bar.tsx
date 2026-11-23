'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import type { SortingState, Updater } from '@tanstack/react-table';
import type { AttendanceReportScope } from '../api/use-attendance-report';
import { AttendanceReportDownloadMessages } from './attendance-report-download-messages';
import { AttendanceReportFilters } from './attendance-report-filters';
import { AttendanceReportSortControl } from './attendance-report-sort-control';
import { useSortFocusHandOver } from './use-sort-focus-hand-over';

/** تصفية كرت التقرير: الشهر والفرع، مربع الفرز تحت 600px، ثم رسائل التنزيل. */
export function AttendanceReportFilterBar({
  scope,
  month,
  branches,
  allowAllBranches,
  sorting,
  onSortingChange,
  sortDisabled,
  onMonth,
  onBranch,
}: {
  scope: AttendanceReportScope;
  month: string;
  branches: WorkspaceBranch[];
  allowAllBranches: boolean;
  sorting: SortingState;
  onSortingChange: (updater: Updater<SortingState>) => void;
  sortDisabled: boolean;
  onMonth: (month: string) => void;
  onBranch: (branchId: string) => void;
}) {
  useSortFocusHandOver(sorting[0]?.id);
  return (
    <div className="flex flex-col gap-3">
      <AttendanceReportFilters
        branches={branches}
        allowAllBranches={allowAllBranches}
        branchId={scope.branchId}
        month={month}
        onMonth={onMonth}
        onBranch={onBranch}
      />
      <AttendanceReportSortControl
        sorting={sorting}
        onSortingChange={onSortingChange}
        disabled={sortDisabled}
      />
      <AttendanceReportDownloadMessages
        key={`${scope.branchId}:${month}`}
        scope={scope}
        month={month}
      />
    </div>
  );
}
