import type { LeaveHistoryItem } from '@pospay/contracts';
import { formatDate, t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import type { ColumnDef } from '@tanstack/react-table';

type Row = LeaveHistoryItem;
type LeaveRow = Extract<Row, { row_type: 'LEAVE' }>;
type Shift = Extract<Row, { row_type: 'UNEXCUSED_ABSENCE' }>['shifts'][number];
export type LeaveHistoryActions = {
  onCancel: (row: LeaveRow) => void;
  onDecide: (row: LeaveRow, decision: 'APPROVED' | 'REJECTED') => void;
  onRevoke: (row: LeaveRow) => void;
};

function civilDate(value: string, locale: Locale): string {
  return formatDate(new Date(`${value}T12:00Z`), {
    locale,
    calendar: 'gregorian',
    timeZone: 'UTC',
  });
}

export function periodColumn(locale: Locale): ColumnDef<Row> {
  return {
    id: 'period',
    header: t(locale, 'leave.date'),
    cell: ({ row: { original: row } }) => {
      if (row.row_type !== 'LEAVE') return civilDate(row.working_date, locale);
      return (
        <span>
          {civilDate(row.from, locale)}–{civilDate(row.to, locale)}
          {row.start ? (
            <span dir="ltr">
              {' '}
              {row.start}–{row.end}
            </span>
          ) : null}
          <span className="block text-xs text-muted-foreground">{row.timezone}</span>
        </span>
      );
    },
  };
}

export function typeColumn(locale: Locale): ColumnDef<Row> {
  return {
    id: 'type',
    header: t(locale, 'leave.type'),
    cell: ({ row: { original: row } }) => {
      if (row.row_type === 'LEAVE') return t(locale, `leave.${row.type}`);
      return t(
        locale,
        row.row_type === 'UNEXCUSED_ABSENCE'
          ? 'leaveHistory.absenceType'
          : 'leaveHistory.coveredElsewhere',
      );
    },
  };
}

export function statusColumn(locale: Locale): ColumnDef<Row> {
  return {
    id: 'status',
    header: t(locale, 'leave.status'),
    cell: ({ row: { original: row } }) => {
      if (row.row_type === 'LEAVE') return t(locale, `leave.${row.status}`);
      return row.row_type === 'UNEXCUSED_ABSENCE' ? t(locale, 'leaveHistory.absentStatus') : null;
    },
  };
}

function leaveDetails(row: LeaveRow, locale: Locale) {
  return (
    <span>
      {row.decision_reason ?? row.rejection_reason}
      {row.revocation_reason ? (
        <span className="block">
          {t(locale, 'leave.revocationReason')}: {row.revocation_reason}
        </span>
      ) : null}
      {row.note ? <span className="block">{row.note}</span> : null}
    </span>
  );
}

function shiftRanges(shifts: Shift[]) {
  return shifts.map((shift, index) => (
    <span key={`${shift.start}-${shift.end}-${index}`}>
      {index > 0 ? ', ' : ''}
      <span dir="ltr">
        {shift.start}–{shift.end}
      </span>
    </span>
  ));
}

export function detailsColumn(locale: Locale): ColumnDef<Row> {
  return {
    id: 'details',
    header: t(locale, 'leave.decisionReason'),
    cell: ({ row: { original: row } }) => {
      if (row.row_type === 'LEAVE') return leaveDetails(row, locale);
      return (
        <span>{shiftRanges(row.row_type === 'UNEXCUSED_ABSENCE' ? row.shifts : [row.shift])}</span>
      );
    },
  };
}

function leaveActions(
  row: LeaveRow,
  locale: Locale,
  pending: boolean,
  actions: LeaveHistoryActions,
) {
  return (
    <div className="flex gap-2">
      {row.can_cancel ? (
        <Button variant="outline" disabled={pending} onClick={() => actions.onCancel(row)}>
          {t(locale, 'leave.cancel')}
        </Button>
      ) : null}
      {row.can_decide ? (
        <>
          <Button disabled={pending} onClick={() => actions.onDecide(row, 'APPROVED')}>
            {t(locale, 'leave.approve')}
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => actions.onDecide(row, 'REJECTED')}
          >
            {t(locale, 'leave.reject')}
          </Button>
        </>
      ) : null}
      {row.can_revoke ? (
        <Button variant="outline" disabled={pending} onClick={() => actions.onRevoke(row)}>
          {t(locale, 'leave.revoke')}
        </Button>
      ) : null}
    </div>
  );
}

function actionsColumn(
  locale: Locale,
  pending: boolean,
  actions: LeaveHistoryActions,
): ColumnDef<Row> {
  return {
    id: 'actions',
    header: t(locale, 'leave.decision'),
    cell: ({ row: { original: row } }) =>
      row.row_type === 'LEAVE' ? leaveActions(row, locale, pending, actions) : null,
  };
}

export function leaveHistoryColumns(
  locale: Locale,
  pending: boolean,
  actions: LeaveHistoryActions,
): ColumnDef<Row>[] {
  return [
    periodColumn(locale),
    typeColumn(locale),
    statusColumn(locale),
    detailsColumn(locale),
    actionsColumn(locale, pending, actions),
  ];
}
