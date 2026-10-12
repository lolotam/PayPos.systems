'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import {
  attendanceSessionActions,
  type AttendanceSession,
} from '../model/attendance-action-display';
export type SessionAction = 'correct' | 'history' | 'void';
export function AttendanceSessionActions({
  row,
  onAction,
}: {
  row: AttendanceSession;
  onAction: (row: AttendanceSession, action: SessionAction) => void;
}) {
  const locale = useLocale();
  const allowed = attendanceSessionActions(row);
  return (
    <div
      role="group"
      aria-label={`${t(locale, 'attendanceActions.actions')}: ${locale === 'ar' ? (row.name_ar ?? row.name_en) : row.name_en}`}
      className="flex flex-wrap gap-2"
    >
      {allowed.correct ? (
        <Button variant="outline" onClick={() => onAction(row, 'correct')}>
          {t(locale, 'attendanceActions.correct')}
        </Button>
      ) : null}
      <Button variant="outline" onClick={() => onAction(row, 'history')}>
        {t(locale, 'attendanceActions.history')}
      </Button>
      {allowed.void ? (
        <Button variant="outline" onClick={() => onAction(row, 'void')}>
          {t(locale, 'attendanceActions.void')}
        </Button>
      ) : null}
    </div>
  );
}
