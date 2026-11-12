'use client';
import type { LeaveHistoryItem, LeaveHistoryQuery, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { offeredAbsence, type LeaveHistoryFilters } from '../model/leave-history-filters';
import type { useLeaveHistory } from '../api/use-leave-history';
import { useLeaveDecisions, type LeaveDecisionScope } from '../api/use-leave-decisions';
import { LeaveDecisionEditor, type LeaveSelection } from './leave-decision-editor';
import { LeaveHistoryFiltersForm } from './leave-history-filters-form';
import { LeaveHistoryRowsTable } from './leave-history-rows-table';
import { LeaveLastTaken } from './leave-last-taken';
import { LeavePagination } from './leave-pagination';

type LeaveRow = Extract<LeaveHistoryItem, { row_type: 'LEAVE' }>;
type Props = {
  scope: LeaveDecisionScope;
  history: ReturnType<typeof useLeaveHistory>;
  branches: WorkspaceBranch[];
  initialFilters: LeaveHistoryFilters;
  cursor: string | undefined;
  onPage: (cursor: string | undefined) => void;
  onApply: (query: LeaveHistoryQuery) => void;
  pending: boolean;
  onCancel: (row: LeaveRow) => void;
};

function useHistoryDecisions(scope: LeaveDecisionScope) {
  const mutations = useLeaveDecisions(scope);
  const [selection, setSelection] = useState<LeaveSelection>();
  const select = (next: LeaveSelection) => {
    mutations.decide.reset();
    mutations.revoke.reset();
    setSelection(next);
  };
  return { mutations, selection, select, clear: () => setSelection(undefined) };
}

function historyView(history: Props['history'], busy: boolean) {
  const absenceOffered = offeredAbsence(history.data?.absence_branch_ids ?? []);
  const leaveItems =
    history.data?.items.filter((row): row is LeaveRow => row.row_type === 'LEAVE') ?? [];
  const rowsPending = history.isPlaceholderData || busy;
  const showRows =
    Boolean(history.data) &&
    (history.isFetchedAfterMount || history.isPlaceholderData) &&
    !history.isError;
  return {
    absenceOffered,
    leaveItems,
    rowsPending,
    showRows,
    loading: !showRows && !history.isError,
  };
}

export function LeaveHistoryPanel({
  scope,
  history,
  branches,
  initialFilters,
  cursor,
  onPage,
  onApply,
  pending,
  onCancel,
}: Props) {
  const locale = useLocale();
  const { mutations, selection, select, clear } = useHistoryDecisions(scope);
  const { absenceOffered, leaveItems, rowsPending, showRows, loading } = historyView(
    history,
    pending || mutations.decide.isPending || mutations.revoke.isPending,
  );
  return (
    <section aria-label={t(locale, 'leaveHistory.historyTitle')} className="flex flex-col gap-4">
      <h3 className="font-bold">{t(locale, 'leaveHistory.historyTitle')}</h3>
      {showRows ? (
        <LeaveLastTaken lastTaken={history.data?.last_taken} showAbsence={absenceOffered} />
      ) : null}
      <LeaveHistoryFiltersForm
        initial={initialFilters}
        absenceOffered={absenceOffered}
        branches={branches}
        onApply={onApply}
      />
      {loading ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
      {history.isError ? <p role="alert">{envelopeMessage(history.error, locale)}</p> : null}
      {showRows && history.data ? (
        <div className="flex flex-col gap-4">
          <LeaveHistoryRowsTable
            items={history.data.items}
            pending={rowsPending}
            onCancel={onCancel}
            onDecide={(row, action) => select({ row, action })}
            onRevoke={(row) => select({ row, action: 'REVOKE' })}
          />
          <LeaveDecisionEditor
            selection={selection}
            items={leaveItems}
            mutations={mutations}
            onClose={clear}
          />
          {history.data.items.length === 0 ? <p>{t(locale, 'leaveHistory.historyEmpty')}</p> : null}
        </div>
      ) : null}
      {showRows || history.isError ? (
        <LeavePagination
          cursor={cursor}
          next={history.isError ? null : (history.data?.next_cursor ?? null)}
          fetching={history.isError ? false : history.isFetching}
          onPage={onPage}
        />
      ) : null}
    </section>
  );
}
