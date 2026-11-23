'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { useAttendanceCapabilities } from '../api/use-attendance-capabilities';
import {
  canRestoreAttendance,
  type AttendanceRequestRow,
} from '../model/attendance-action-display';
export type RequestAction = 'approve' | 'reject' | 'withdraw' | 'restore';
export function AttendanceRequestRowActions({
  row,
  onAction,
  scope,
}: {
  row: AttendanceRequestRow;
  scope: AttendanceBoardScope;
  onAction: (row: AttendanceRequestRow, action: RequestAction) => void;
}) {
  const locale = useLocale();
  const restoreEligible = canRestoreAttendance(row);
  const { capabilities } = useAttendanceCapabilities(scope, restoreEligible);
  const decide = row.status === 'PENDING' && row.can_decide;
  const withdraw = row.status === 'PENDING' && row.can_cancel;
  const restore = restoreEligible && capabilities.request_change;
  // بلا أي زر لا نرسم غلافًا فارغًا، فتنكمش الخلية تحت 600px.
  if (!decide && !withdraw && !restore) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {decide ? (
        <>
          <Button variant="outline" onClick={() => onAction(row, 'approve')}>
            {t(locale, 'attendanceActions.approve')}
          </Button>
          <Button variant="outline" onClick={() => onAction(row, 'reject')}>
            {t(locale, 'attendanceActions.reject')}
          </Button>
        </>
      ) : null}
      {withdraw ? (
        <Button variant="outline" onClick={() => onAction(row, 'withdraw')}>
          {t(locale, 'attendanceActions.withdraw')}
        </Button>
      ) : null}
      {restore ? (
        <Button variant="outline" onClick={() => onAction(row, 'restore')}>
          {t(locale, 'attendanceActions.restore')}
        </Button>
      ) : null}
    </div>
  );
}
