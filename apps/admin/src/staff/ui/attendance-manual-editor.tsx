'use client';
import { t } from '@pospay/i18n';
import type { WorkspaceBranch } from '@pospay/contracts';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { useAttendanceActions } from '../api/use-attendance-actions';
import { AttendanceActionDialog } from './attendance-action-dialog';
import { AttendanceActionFeedback } from './attendance-action-feedback';
import { AttendanceManualForm } from './attendance-manual-form';
export function AttendanceManualEditor({
  scope,
  timezone,
  onClose,
  branch,
}: {
  scope: AttendanceBoardScope;
  timezone: string;
  onClose: () => void;
  branch?: WorkspaceBranch | undefined;
}) {
  const locale = useLocale();
  const { request } = useAttendanceActions(scope);
  return (
    <AttendanceActionDialog
      title={t(locale, 'attendanceActions.manual')}
      pending={request.isPending}
      onClose={onClose}
    >
      {branch ? (
        <p>
          {t(locale, 'attendanceBoard.branch')}:{' '}
          {locale === 'ar' ? (branch.name_ar ?? branch.name_en) : branch.name_en}
        </p>
      ) : null}
      <AttendanceManualForm
        scope={scope}
        timezone={timezone}
        pending={request.isPending}
        onClose={onClose}
        onSave={(input) => request.mutate(input, { onSuccess: onClose })}
      />
      <AttendanceActionFeedback error={request.error} write />
    </AttendanceActionDialog>
  );
}
