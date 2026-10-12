'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { useAttendanceActions } from '../api/use-attendance-actions';
import {
  restoreAttendanceInput,
  type AttendanceRequestRow,
} from '../model/attendance-action-display';
import { AttendanceReasonForm } from './attendance-reason-form';
import { AttendanceRequestDecisionForm } from './attendance-request-decision-form';
import type { RequestAction } from './attendance-request-row-actions';
type Props = {
  row: AttendanceRequestRow;
  action: RequestAction;
  mutations: ReturnType<typeof useAttendanceActions>;
  onClose: () => void;
};
export function AttendanceRequestEditorForm({ row, action, mutations, onClose }: Props) {
  const locale = useLocale();
  const { request, decide, cancel } = mutations;
  if (action === 'restore')
    return (
      <>
        <p>{t(locale, 'attendanceActions.restoreHint')}</p>
        <AttendanceReasonForm
          revision={row.revision}
          pending={request.isPending}
          onClose={onClose}
          onSave={({ reason }) => {
            const input = restoreAttendanceInput(row, reason);
            if (input) request.mutate(input, { onSuccess: onClose });
          }}
        />
      </>
    );
  if (action === 'withdraw')
    return (
      <div className="flex gap-2">
        <Button
          disabled={cancel.isPending}
          onClick={() =>
            cancel.mutate({ id: row.id, input: { revision: row.revision } }, { onSuccess: onClose })
          }
        >
          {t(locale, 'attendanceActions.withdraw')}
        </Button>
        <Button variant="outline" disabled={cancel.isPending} onClick={onClose}>
          {t(locale, 'attendanceActions.close')}
        </Button>
      </div>
    );
  return (
    <AttendanceRequestDecisionForm
      decision={action === 'approve' ? 'APPROVED' : 'REJECTED'}
      revision={row.revision}
      pending={decide.isPending}
      onClose={onClose}
      onSave={(input) => decide.mutate({ id: row.id, input }, { onSuccess: onClose })}
    />
  );
}
