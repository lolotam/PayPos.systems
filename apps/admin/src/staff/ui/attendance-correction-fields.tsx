'use client';
import type { CorrectAttendanceInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import type { UseFormRegister } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { attendanceLocalTime, attendanceUtc } from '../model/attendance-local-time';
import type { AttendanceSession } from '../model/attendance-action-display';
export function AttendanceCorrectionFields({
  row,
  timezone,
  register,
}: {
  row: AttendanceSession;
  timezone: string;
  register: UseFormRegister<CorrectAttendanceInput>;
}) {
  const locale = useLocale();
  return (
    <>
      {(['clock_in', 'clock_out'] as const).map((field) => (
        <div key={field} className="grid gap-1">
          <Label htmlFor={`correction-${field}`}>
            {t(
              locale,
              field === 'clock_in' ? 'attendanceBoard.clockIn' : 'attendanceBoard.clockOut',
            )}
          </Label>
          <p className="text-sm text-muted-foreground">
            <bdi>
              {row[field]
                ? attendanceLocalTime(row[field], timezone)
                : t(locale, 'attendanceBoard.unavailable')}
            </bdi>
          </p>
          <Input
            id={`correction-${field}`}
            type="datetime-local"
            step="1"
            {...register(field, { setValueAs: (value: string) => attendanceUtc(value, timezone) })}
          />
        </div>
      ))}
    </>
  );
}
