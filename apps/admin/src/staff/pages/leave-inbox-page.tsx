'use client';
import type { LeaveInboxQuery, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useLeaveInbox } from '../api/use-leave-inbox';
import type { LeaveDecisionScope } from '../api/use-leave-decisions';
import { EmployeeLeaveHistory } from '../ui/employee-leave-history';
import { LeaveInboxFilters } from '../ui/leave-inbox-filters';
import { LeavePagination } from '../ui/leave-pagination';
export function LeaveInboxPage({
  scope,
  branches,
}: {
  scope: LeaveDecisionScope;
  branches: WorkspaceBranch[];
}) {
  const locale = useLocale();
  const [query, setQuery] = useState<LeaveInboxQuery>({ limit: 20 });
  const inbox = useLeaveInbox(scope, query);
  return (
    <section className="flex flex-col gap-6 text-start">
      <PageHeader title={t(locale, 'leave.inbox')} />
      <LeaveInboxFilters
        branches={branches}
        onApply={(next) => {
          setQuery(next);
        }}
      />
      {inbox.isError ? <p role="alert">{envelopeMessage(inbox.error, locale)}</p> : null}
      {!inbox.isFetchedAfterMount && !inbox.isError ? (
        <p role="status">{t(locale, 'admin.loading')}</p>
      ) : null}
      {inbox.data && !inbox.isError ? (
        <>
          <EmployeeLeaveHistory
            key={JSON.stringify(query)}
            items={inbox.data.items}
            scope={scope}
            includeEmployee
          />
          {inbox.data.items.length === 0 ? <p>{t(locale, 'leave.empty')}</p> : null}
          <LeavePagination
            cursor={query.cursor}
            next={inbox.data.next_cursor}
            fetching={inbox.isFetching}
            onPage={(cursor) => {
              const { cursor: _old, ...filters } = query;
              void _old;
              setQuery({ ...filters, ...(cursor ? { cursor } : {}) });
            }}
          />
        </>
      ) : null}
    </section>
  );
}
