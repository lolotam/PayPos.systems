'use client';
import type { LeavePage, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import type { useLeave } from '../api/use-leave';
import type { LeaveDecisionScope } from '../api/use-leave-decisions';
import { EmployeeLeaveHistory } from './employee-leave-history';
import { LeavePagination } from './leave-pagination';
import { LeaveRequestForm } from './leave-request-form';

type Row = LeavePage['items'][number];

export function LeaveOpenRequests({
  scope,
  open,
  save,
  allowed,
  pending,
  cursor,
  onPage,
  onCancel,
}: {
  scope: LeaveDecisionScope;
  open: ReturnType<typeof useLeave>['open'];
  save: ReturnType<typeof useLeave>['save'];
  allowed: WorkspaceBranch[];
  pending: boolean;
  cursor: string | undefined;
  onPage: (cursor: string | undefined) => void;
  onCancel: (row: Row) => void;
}) {
  const locale = useLocale();
  const showRows =
    Boolean(open.data) && (open.isFetchedAfterMount || open.isPlaceholderData) && !open.isError;
  const loading = !showRows && !open.isError;
  return (
    <section aria-label={t(locale, 'leaveHistory.openTitle')} className="flex flex-col gap-4">
      <h3 className="font-bold">{t(locale, 'leaveHistory.openTitle')}</h3>
      {loading ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
      {open.isError ? <p role="alert">{envelopeMessage(open.error, locale)}</p> : null}
      {showRows && open.data ? (
        <>
          <EmployeeLeaveHistory
            scope={scope}
            items={open.data.items}
            pending={pending || open.isPlaceholderData}
            onCancel={onCancel}
          />
          {open.data.items.length === 0 ? <p>{t(locale, 'leaveHistory.openEmpty')}</p> : null}
        </>
      ) : null}
      {showRows || open.isError ? (
        <LeavePagination
          cursor={cursor}
          next={open.isError ? null : (open.data?.next_cursor ?? null)}
          fetching={open.isError ? false : open.isFetching}
          onPage={onPage}
        />
      ) : null}
      {allowed.length > 0 ? (
        <LeaveRequestForm
          branches={allowed}
          pending={save.isPending}
          onSave={(input) => save.mutate(input, { onSuccess: () => onPage(undefined) })}
        />
      ) : null}
    </section>
  );
}
