import type { LeavePage } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import type { ColumnDef } from '@tanstack/react-table';
type Row = LeavePage['items'][number];
export type LeaveDecisionActions = {
  onDecide?: (row: Row, decision: 'APPROVED' | 'REJECTED') => void;
  onRevoke?: (row: Row) => void;
  includeEmployee?: boolean;
};
function reasonColumn(locale: Locale): ColumnDef<Row> {
  return {
    id: 'reason',
    header: t(locale, 'leave.decisionReason'),
    cell: ({ row: { original: r } }) => (
      <span>
        {r.decision_reason ?? r.rejection_reason}
        {r.revocation_reason ? (
          <span className="block">
            {t(locale, 'leave.revocationReason')}: {r.revocation_reason}
          </span>
        ) : null}
      </span>
    ),
  };
}
export function leaveDecisionColumns(
  locale: Locale,
  pending: boolean,
  actions: LeaveDecisionActions,
): ColumnDef<Row>[] {
  return [
    ...(actions.includeEmployee
      ? [
          {
            id: 'employee',
            header: t(locale, 'leave.employee'),
            cell: ({ row }: { row: { original: Row } }) =>
              locale === 'ar'
                ? (row.original.employee_name_ar ?? row.original.employee_name_en)
                : row.original.employee_name_en,
          },
        ]
      : []),
    reasonColumn(locale),
    {
      id: 'decision',
      header: t(locale, 'leave.decision'),
      cell: ({ row: { original: r } }) => (
        <div className="flex gap-2">
          {r.can_decide && actions.onDecide ? (
            <>
              <Button disabled={pending} onClick={() => actions.onDecide?.(r, 'APPROVED')}>
                {t(locale, 'leave.approve')}
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => actions.onDecide?.(r, 'REJECTED')}
              >
                {t(locale, 'leave.reject')}
              </Button>
            </>
          ) : null}
          {r.can_revoke && actions.onRevoke ? (
            <Button variant="outline" disabled={pending} onClick={() => actions.onRevoke?.(r)}>
              {t(locale, 'leave.revoke')}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];
}
