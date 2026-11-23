'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import type { ReactNode } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { offeredAbsence } from '../model/leave-history-filters';
import type { LeaveReportView } from '../model/leave-report-view';
import { LeaveLastTaken } from './leave-last-taken';
import { LeavePagination } from './leave-pagination';
import { LeaveReportRowsTable } from './leave-report-rows-table';

function leaveReportBody(view: LeaveReportView, branches: WorkspaceBranch[], locale: Locale) {
  const page = view.page;
  if (view.status === 'ready' && page) {
    return (
      <>
        <div className="p-4 empty:hidden">
          <LeaveLastTaken
            lastTaken={view.lastTaken}
            showAbsence={offeredAbsence(page.absence_branch_ids)}
          />
        </div>
        <LeaveReportRowsTable items={page.items} branches={branches} />
        {page.items.length === 0 && page.next_cursor === null ? (
          <p className="p-4">{t(locale, 'leaveHistory.historyEmpty')}</p>
        ) : null}
      </>
    );
  }
  return (
    <>
      {view.status === 'loading' ? (
        <p role="status" className="p-4">
          {t(locale, 'admin.loading')}
        </p>
      ) : null}
      {view.status === 'preparing' ? (
        <p role="status" className="p-4">
          {t(locale, 'leaveHistory.reportPreparing')}
        </p>
      ) : null}
      {view.status === 'failed' || view.status === 'error' ? (
        <p role="alert" className="p-4">
          {envelopeMessage(view.error, locale)}
        </p>
      ) : null}
    </>
  );
}

function leaveReportFooter(view: LeaveReportView) {
  const page = view.page;
  const ready = view.status === 'ready' && page;
  if (!ready && view.status !== 'error') return undefined;
  return (
    <LeavePagination
      cursor={view.cursor}
      next={ready ? page.next_cursor : null}
      fetching={view.fetching}
      onPage={view.setCursor}
    />
  );
}

/**
 * كرت التقرير: التصفية في مكانها الثابت في كل الحالات، والمحتوى والتذييل يتغيران معًا
 * من لقطة واحدة للاستعلام، فلا يبقى تذييل صفحات بجانب خطأ أو قائمة فارغة.
 */
export function LeaveReportResults({
  view,
  branches,
  filters,
}: {
  view: LeaveReportView;
  branches: WorkspaceBranch[];
  filters: ReactNode;
}) {
  const locale = useLocale();
  return (
    <DataTableFrame stacked filters={filters} footer={leaveReportFooter(view)}>
      {leaveReportBody(view, branches, locale)}
    </DataTableFrame>
  );
}
