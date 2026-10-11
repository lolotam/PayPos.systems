'use client';
import { t } from '@pospay/i18n';
import { NativeSelect } from '@pospay/ui';
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
    <NativeSelect
      aria-label={`${t(locale, 'attendanceActions.actions')}: ${locale === 'ar' ? (row.name_ar ?? row.name_en) : row.name_en}`}
      value=""
      onChange={(event) => {
        if (event.target.value) onAction(row, event.target.value as SessionAction);
      }}
    >
      <option value="" disabled>
        {t(locale, 'attendanceActions.actions')}
      </option>
      {allowed.correct ? (
        <option value="correct">{t(locale, 'attendanceActions.correct')}</option>
      ) : null}
      <option value="history">{t(locale, 'attendanceActions.history')}</option>
      {allowed.void ? <option value="void">{t(locale, 'attendanceActions.void')}</option> : null}
    </NativeSelect>
  );
}
