'use client';
import type { LeavePage, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeLeaveTab } from '../api/use-employee-leave-tab';
import { fromHistoryQuery } from '../model/leave-history-filters';
import { LeaveHistoryPanel } from './leave-history-panel';
import { LeaveOpenRequests } from './leave-open-requests';

type Row = LeavePage['items'][number];

export function EmployeeLeaveSection({
  companyId,
  businessId,
  userId,
  employeeId,
  branches,
  timeZone,
}: {
  companyId: string;
  businessId: string;
  userId: string;
  employeeId: string;
  branches: WorkspaceBranch[];
  timeZone?: string | undefined;
}) {
  const locale = useLocale();
  const scope = { companyId, businessId, userId };
  const tab = useEmployeeLeaveTab({ ...scope, employeeId, branches, timeZone });
  const ids = tab.open.data?.request_branch_ids ?? tab.history.data?.request_branch_ids ?? [];
  const allowed = branches.filter((branch) => ids.includes(branch.id));
  const onCancel = (row: Row) => {
    if (window.confirm(t(locale, 'leave.confirmCancel'))) {
      tab.cancel.mutate({ leaveId: row.id, revision: row.revision });
    }
  };
  return (
    <section aria-label={t(locale, 'leaveHistory.tabLeave')} className="flex flex-col gap-6">
      <LeaveOpenRequests
        scope={scope}
        open={tab.open}
        save={tab.save}
        allowed={allowed}
        pending={tab.cancel.isPending}
        cursor={tab.openCursor}
        onPage={tab.setOpenCursor}
        onCancel={onCancel}
      />
      <LeaveHistoryPanel
        key={JSON.stringify(tab.applied)}
        scope={scope}
        history={tab.history}
        branches={branches}
        initialFilters={tab.applied ? fromHistoryQuery(tab.applied) : tab.initialFilters}
        cursor={tab.historyCursor}
        onPage={tab.setHistoryCursor}
        onApply={tab.applyFilters}
        pending={tab.cancel.isPending}
        onCancel={onCancel}
      />
      {tab.save.isError ? <p role="alert">{envelopeMessage(tab.save.error, locale)}</p> : null}
      {tab.cancel.isError ? <p role="alert">{envelopeMessage(tab.cancel.error, locale)}</p> : null}
      {tab.save.isSuccess ? <p role="status">{t(locale, 'leave.saved')}</p> : null}
      {tab.cancel.isSuccess ? <p role="status">{t(locale, 'leave.cancelled')}</p> : null}
    </section>
  );
}
