import type { LeaveHistoryItem } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import type { ColumnDef } from '@tanstack/react-table';
import { detailsColumn, periodColumn, statusColumn, typeColumn } from './leave-history-columns';

type Row = LeaveHistoryItem;

function employeeName(row: Row, locale: Locale): string {
  return locale === 'ar' ? (row.employee_name_ar ?? row.employee_name_en) : row.employee_name_en;
}

function employeeColumn(locale: Locale): ColumnDef<Row> {
  return {
    id: 'employee',
    header: t(locale, 'leaveHistory.reportEmployee'),
    cell: ({ row: { original: row } }) => (
      <span>
        {employeeName(row, locale)} #{row.employee_number}
      </span>
    ),
  };
}

function branchColumn(locale: Locale, branchNames: Map<string, string>): ColumnDef<Row> {
  return {
    id: 'branch',
    header: t(locale, 'leave.branch'),
    cell: ({ row: { original: row } }) => branchNames.get(row.branch_id) ?? null,
  };
}

export function leaveReportColumns(
  locale: Locale,
  branchNames: Map<string, string>,
): ColumnDef<Row>[] {
  return [
    employeeColumn(locale),
    periodColumn(locale),
    branchColumn(locale, branchNames),
    typeColumn(locale),
    statusColumn(locale),
    detailsColumn(locale),
  ];
}
