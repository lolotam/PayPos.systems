'use client';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { useAttendanceActions } from '../api/use-attendance-actions';
import { voidAttendanceInput, type AttendanceSession } from '../model/attendance-action-display';
import { AttendanceActionDialog } from './attendance-action-dialog';
import { AttendanceActionFeedback } from './attendance-action-feedback';
import { AttendanceReasonForm } from './attendance-reason-form';
import { AttendanceCorrectionForm } from './attendance-correction-form';
import { AttendanceHistoryDialog } from './attendance-history-dialog';
import type { SessionAction } from './attendance-session-actions';
export function AttendanceSessionEditor({
  scope,
  row,
  action,
  timezone,
  onClose,
}: {
  scope: AttendanceBoardScope;
  row: AttendanceSession;
  action: SessionAction;
  timezone: string;
  onClose: () => void;
}) {
  const locale = useLocale();
  const mutations = useAttendanceActions(scope);
  if (action === 'history')
    return (
      <AttendanceHistoryDialog
        scope={scope}
        sessionId={row.id}
        timezone={timezone}
        onClose={onClose}
      />
    );
  const mutation = action === 'correct' ? mutations.correct : mutations.request;
  return (
    <AttendanceActionDialog
      title={t(locale, `attendanceActions.${action}`)}
      pending={mutation.isPending}
      onClose={onClose}
    >
      <p>{locale === 'ar' ? (row.name_ar ?? row.name_en) : row.name_en}</p>
      {action === 'correct' ? (
        <AttendanceCorrectionForm
          row={row}
          timezone={timezone}
          pending={mutation.isPending}
          onClose={onClose}
          onSave={(input) =>
            mutations.correct.mutate({ id: row.id, input }, { onSuccess: onClose })
          }
        />
      ) : (
        <AttendanceReasonForm
          revision={row.revision}
          pending={mutation.isPending}
          onClose={onClose}
          onSave={({ reason }) =>
            mutations.request.mutate(voidAttendanceInput(row, reason), { onSuccess: onClose })
          }
        />
      )}
      <AttendanceActionFeedback error={mutation.error} />
    </AttendanceActionDialog>
  );
}
