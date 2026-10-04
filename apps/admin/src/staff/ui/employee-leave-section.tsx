'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useLeave } from '../api/use-leave';
import { EmployeeLeaveHistory } from './employee-leave-history';
import { LeaveRequestForm } from './leave-request-form';
import { LeavePagination } from './leave-pagination';
export function EmployeeLeaveSection({
  companyId,
  businessId,
  userId,
  employeeId,
  branches,
}: {
  companyId: string;
  businessId: string;
  userId: string;
  employeeId: string;
  branches: WorkspaceBranch[];
}) {
  const locale = useLocale();
  const [cursor, setCursor] = useState<string>();
  const { history, save, cancel } = useLeave(companyId, businessId, userId, employeeId, cursor);
  if (history.isError) return <p role="alert">{envelopeMessage(history.error, locale)}</p>;
  if (!history.isFetchedAfterMount || !history.data)
    return <p role="status">{t(locale, 'admin.loading')}</p>;
  const data = history.data;
  const allowed = branches.filter((b) => data.request_branch_ids.includes(b.id));
  return (
    <section aria-label={t(locale, 'leave.title')} className="flex flex-col gap-4">
      <h3 className="font-bold">{t(locale, 'leave.title')}</h3>
      <EmployeeLeaveHistory
        scope={{ companyId, businessId, userId }}
        items={data.items}
        pending={cancel.isPending}
        onCancel={(row) => {
          if (window.confirm(t(locale, 'leave.confirmCancel')))
            cancel.mutate({ leaveId: row.id, revision: row.revision });
        }}
      />
      {data.items.length === 0 ? <p>{t(locale, 'leave.empty')}</p> : null}
      <LeavePagination
        cursor={cursor}
        next={data.next_cursor}
        fetching={history.isFetching}
        onPage={setCursor}
      />
      {allowed.length > 0 ? (
        <LeaveRequestForm
          branches={allowed}
          pending={save.isPending}
          onSave={(input) => save.mutate(input, { onSuccess: () => setCursor(undefined) })}
        />
      ) : null}
      {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
      {cancel.isError ? <p role="alert">{envelopeMessage(cancel.error, locale)}</p> : null}
      {save.isSuccess ? <p role="status">{t(locale, 'leave.saved')}</p> : null}
      {cancel.isSuccess ? <p role="status">{t(locale, 'leave.cancelled')}</p> : null}
    </section>
  );
}
