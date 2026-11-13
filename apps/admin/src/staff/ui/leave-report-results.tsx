'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { offeredAbsence } from '../model/leave-history-filters';
import type { LeaveReportView } from '../model/leave-report-view';
import { LeaveLastTaken } from './leave-last-taken';
import { LeavePagination } from './leave-pagination';
import { LeaveReportRowsTable } from './leave-report-rows-table';

export function LeaveReportResults({
  view,
  branches,
}: {
  view: LeaveReportView;
  branches: WorkspaceBranch[];
}) {
  const locale = useLocale();
  const page = view.page;
  if (view.status === 'ready' && page) {
    return (
      <div className="flex flex-col gap-4">
        <LeaveLastTaken
          lastTaken={view.lastTaken}
          showAbsence={offeredAbsence(page.absence_branch_ids)}
        />
        <LeaveReportRowsTable items={page.items} branches={branches} />
        {page.items.length === 0 && page.next_cursor === null ? (
          <p>{t(locale, 'leaveHistory.historyEmpty')}</p>
        ) : null}
        <LeavePagination
          cursor={view.cursor}
          next={page.next_cursor}
          fetching={view.fetching}
          onPage={view.setCursor}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {view.status === 'loading' ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
      {view.status === 'preparing' ? (
        <p role="status">{t(locale, 'leaveHistory.reportPreparing')}</p>
      ) : null}
      {view.status === 'failed' || view.status === 'error' ? (
        <p role="alert">{envelopeMessage(view.error, locale)}</p>
      ) : null}
      {view.status === 'error' ? (
        <LeavePagination
          cursor={view.cursor}
          next={null}
          fetching={view.fetching}
          onPage={view.setCursor}
        />
      ) : null}
    </div>
  );
}
