'use client';
import type { LeavePage } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import type { useLeaveDecisions } from '../api/use-leave-decisions';
import { LeaveDecisionForm } from './leave-decision-form';
import { LeaveRevocationForm } from './leave-revocation-form';
type Row = LeavePage['items'][number];
export type LeaveSelection = { row: Row; action: 'APPROVED' | 'REJECTED' | 'REVOKE' };
export function LeaveDecisionEditor({
  selection,
  items,
  mutations,
  onClose,
}: {
  selection: LeaveSelection | undefined;
  items: Row[];
  mutations: ReturnType<typeof useLeaveDecisions>;
  onClose: () => void;
}) {
  const locale = useLocale();
  const { decide, revoke } = mutations;
  const current =
    selection &&
    items.find(
      (r) =>
        r.id === selection.row.id &&
        r.revision === selection.row.revision &&
        (selection.action === 'REVOKE' ? r.can_revoke : r.can_decide),
    );
  const target = current ? { employeeId: current.employee_id, leaveId: current.id } : null;
  return (
    <div className="flex flex-col gap-3">
      {current && target && selection ? (
        <>
          <p>
            {locale === 'ar'
              ? (current.employee_name_ar ?? current.employee_name_en)
              : current.employee_name_en}{' '}
            · {current.from}–{current.to}
          </p>
          {selection.action === 'REVOKE' ? (
            <LeaveRevocationForm
              key={`${current.id}:${current.revision}:revoke`}
              revision={current.revision}
              pending={revoke.isPending}
              onClose={onClose}
              onSave={(input) => revoke.mutate({ target, input }, { onSuccess: onClose })}
            />
          ) : (
            <LeaveDecisionForm
              key={`${current.id}:${current.revision}:${selection.action}`}
              decision={selection.action}
              revision={current.revision}
              pending={decide.isPending}
              onClose={onClose}
              onSave={(input) => decide.mutate({ target, input }, { onSuccess: onClose })}
            />
          )}
        </>
      ) : null}
      {decide.isError ? <p role="alert">{envelopeMessage(decide.error, locale)}</p> : null}
      {revoke.isError ? <p role="alert">{envelopeMessage(revoke.error, locale)}</p> : null}
      {decide.isSuccess ? <p role="status">{t(locale, 'leave.decisionSaved')}</p> : null}
      {revoke.isSuccess ? <p role="status">{t(locale, 'leave.revoked')}</p> : null}
    </div>
  );
}
