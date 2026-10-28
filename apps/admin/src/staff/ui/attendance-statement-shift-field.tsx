'use client';
import { t } from '@pospay/i18n';
import { Label, NativeSelect } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type {
  StatementDraft,
  StatementDraftPatch,
  StatementShift,
} from '../model/attendance-statement-display';

/** فلتر الشيفت في كشف الفرع؛ مفيش فلتر شيفت في كشف الموظفة (FR-001). */
export function AttendanceStatementShiftField(props: {
  draft: StatementDraft;
  shifts: StatementShift[];
  onChange: (patch: StatementDraftPatch) => void;
}) {
  const locale = useLocale();
  const { draft, shifts } = props;
  return (
    <div className="grid gap-1">
      <Label htmlFor="statement-shift">{t(locale, 'attendanceStatementScreen.shift')}</Label>
      <NativeSelect
        id="statement-shift"
        value={draft.shift ? `${draft.shift.start}|${draft.shift.end}` : ''}
        onChange={(event) => {
          const [start, end] = event.target.value.split('|');
          props.onChange({ shift: start && end ? { start, end } : undefined });
        }}
      >
        <option value="">{t(locale, 'attendanceStatementScreen.shiftAll')}</option>
        {shifts.map((shift) => (
          <option key={`${shift.start}|${shift.end}`} value={`${shift.start}|${shift.end}`}>
            {shift.start} — {shift.end}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
