'use client';
import type { LeavePage } from '@pospay/contracts';
import { useState } from 'react';
import { useLeaveDecisions, type LeaveDecisionScope } from '../api/use-leave-decisions';
import { LeaveHistoryTable } from './leave-history-table';
import { LeaveDecisionEditor, type LeaveSelection } from './leave-decision-editor';
type Row = LeavePage['items'][number];
export function EmployeeLeaveHistory({
  items,
  scope,
  pending = false,
  onCancel,
  includeEmployee = false,
  stacked = false,
}: {
  items: Row[];
  scope: LeaveDecisionScope;
  pending?: boolean;
  onCancel?: (row: Row) => void;
  includeEmployee?: boolean;
  stacked?: boolean;
}) {
  const mutations = useLeaveDecisions(scope);
  const [selection, setSelection] = useState<LeaveSelection>();
  const select = (next: LeaveSelection) => {
    mutations.decide.reset();
    mutations.revoke.reset();
    setSelection(next);
  };
  return (
    <div
      className={
        stacked ? 'flex flex-col [&>div:last-child:not(:empty)]:p-4' : 'flex flex-col gap-4'
      }
    >
      <LeaveHistoryTable
        items={items}
        pending={pending || mutations.decide.isPending || mutations.revoke.isPending}
        {...(onCancel ? { onCancel } : {})}
        includeEmployee={includeEmployee}
        stacked={stacked}
        onDecide={(row, action) => select({ row, action })}
        onRevoke={(row) => select({ row, action: 'REVOKE' })}
      />
      <LeaveDecisionEditor
        selection={selection}
        items={items}
        mutations={mutations}
        onClose={() => setSelection(undefined)}
      />
    </div>
  );
}
