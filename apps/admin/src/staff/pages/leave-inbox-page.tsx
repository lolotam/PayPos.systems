'use client';
import type { LeaveInboxQuery, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DataTableFrame, PageHeader, PageShell } from '@pospay/ui';
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
  const listed = inbox.data && !inbox.isError ? inbox.data : undefined;
  return (
    <PageShell layout="list">
      <PageHeader title={t(locale, 'leave.inbox')} />
      <DataTableFrame
        stacked
        filters={<LeaveInboxFilters branches={branches} onApply={setQuery} />}
        footer={
          listed ? (
            <LeavePagination
              cursor={query.cursor}
              next={listed.next_cursor}
              fetching={inbox.isFetching}
              onPage={(cursor) => {
                const { cursor: _old, ...filters } = query;
                void _old;
                setQuery({ ...filters, ...(cursor ? { cursor } : {}) });
              }}
            />
          ) : undefined
        }
      >
        {inbox.isError ? (
          <p role="alert" className="p-4">
            {envelopeMessage(inbox.error, locale)}
          </p>
        ) : null}
        {!inbox.isFetchedAfterMount && !inbox.isError ? (
          <p role="status" className="p-4">
            {t(locale, 'admin.loading')}
          </p>
        ) : null}
        {listed ? (
          <>
            <EmployeeLeaveHistory
              key={JSON.stringify(query)}
              items={listed.items}
              scope={scope}
              includeEmployee
              stacked
            />
            {listed.items.length === 0 ? <p className="p-4">{t(locale, 'leave.empty')}</p> : null}
          </>
        ) : null}
      </DataTableFrame>
    </PageShell>
  );
}
