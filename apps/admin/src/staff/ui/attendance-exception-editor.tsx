'use client';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { useAttendanceActions } from '../api/use-attendance-actions';
import { AttendanceActionDialog } from './attendance-action-dialog';
import { AttendanceActionFeedback } from './attendance-action-feedback';
import { AttendanceReasonForm } from './attendance-reason-form';
import type { ExceptionRow } from './attendance-exception-columns';
export function AttendanceExceptionEditor({
  scope,
  row,
  onClose,
}: {
  scope: AttendanceBoardScope;
  row: ExceptionRow;
  onClose: () => void;
}) {
  const locale = useLocale();
  const { exception } = useAttendanceActions(scope);
  const action = row.status === 'OPEN' ? 'resolve' : 'reopen';
  return (
    <AttendanceActionDialog
      title={t(locale, `attendanceActions.${action}`)}
      pending={exception.isPending}
      onClose={onClose}
    >
      <p>
        {locale === 'ar' ? (row.employee.name_ar ?? row.employee.name_en) : row.employee.name_en}
      </p>
      {action === 'resolve' ? (
        <p>
          {t(locale, 'attendanceActions.resolution')}: {t(locale, 'attendanceActions.ACKNOWLEDGED')}
        </p>
      ) : null}
      <AttendanceReasonForm
        revision={row.revision}
        pending={exception.isPending}
        onClose={onClose}
        onSave={(input) => exception.mutate({ id: row.id, action, input }, { onSuccess: onClose })}
      />
      <AttendanceActionFeedback error={exception.error} />
    </AttendanceActionDialog>
  );
}
