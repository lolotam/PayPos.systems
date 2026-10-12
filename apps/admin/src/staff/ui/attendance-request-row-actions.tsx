'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import {
  canRestoreAttendance,
  type AttendanceRequestRow,
} from '../model/attendance-action-display';
export type RequestAction = 'approve' | 'reject' | 'withdraw' | 'restore';
export function AttendanceRequestRowActions({
  row,
  onAction,
}: {
  row: AttendanceRequestRow;
  onAction: (row: AttendanceRequestRow, action: RequestAction) => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-wrap gap-2">
      {row.status === 'PENDING' && row.can_decide ? (
        <>
          <Button variant="outline" onClick={() => onAction(row, 'approve')}>
            {t(locale, 'attendanceActions.approve')}
          </Button>
          <Button variant="outline" onClick={() => onAction(row, 'reject')}>
            {t(locale, 'attendanceActions.reject')}
          </Button>
        </>
      ) : null}
      {row.status === 'PENDING' && row.can_cancel ? (
        <Button variant="outline" onClick={() => onAction(row, 'withdraw')}>
          {t(locale, 'attendanceActions.withdraw')}
        </Button>
      ) : null}
      {canRestoreAttendance(row) ? (
        <Button variant="outline" onClick={() => onAction(row, 'restore')}>
          {t(locale, 'attendanceActions.restore')}
        </Button>
      ) : null}
    </div>
  );
}
