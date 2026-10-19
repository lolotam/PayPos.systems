'use client';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { useAttendanceActions } from '../api/use-attendance-actions';
import type { AttendanceRequestRow } from '../model/attendance-action-display';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import { AttendanceActionFeedback } from './attendance-action-feedback';
import { AttendanceRequestEditorForm } from './attendance-request-editor-form';
import type { RequestAction } from './attendance-request-row-actions';
import { useAttendanceCapabilities } from '../api/use-attendance-capabilities';
export function AttendanceRequestEditor({
  scope,
  row,
  action,
  onClose,
}: {
  scope: AttendanceBoardScope;
  row: AttendanceRequestRow;
  action: RequestAction;
  onClose: () => void;
}) {
  const locale = useLocale();
  const mutations = useAttendanceActions(scope);
  const { capabilities } = useAttendanceCapabilities(scope, action === 'restore');
  const { request, decide, cancel } = mutations;
  const mutation = action === 'restore' ? request : action === 'withdraw' ? cancel : decide;
  if (
    action === 'restore'
      ? !capabilities.request_change
      : action === 'withdraw'
        ? !row.can_cancel
        : !row.can_decide
  )
    return null;
  return (
    <ModalDialog
      title={t(locale, `attendanceActions.${action}`)}
      pending={mutation.isPending}
      onClose={onClose}
    >
      <p>
        {locale === 'ar' ? (row.employee.name_ar ?? row.employee.name_en) : row.employee.name_en}
      </p>
      <p>{row.reason}</p>
      <AttendanceRequestEditorForm
        row={row}
        action={action}
        mutations={mutations}
        onClose={onClose}
      />
      <AttendanceActionFeedback error={mutation.error} write />
    </ModalDialog>
  );
}
