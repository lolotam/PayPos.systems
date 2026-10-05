'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { setScheduleInput, type ScheduleGrid, type SetScheduleInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { useForm } from 'react-hook-form';
import { useScheduleSave, type ScheduleWorkspace } from '../api/use-schedules';
import { branchCivilDate, scheduleFormDefaults } from './schedule-form';
export function useScheduleEditor(
  scope: ScheduleWorkspace,
  row: ScheduleGrid['items'][number],
  grid: ScheduleGrid,
  day: number,
  locale: Locale,
  onClose: () => void,
) {
  const save = useScheduleSave(scope, row.employee_id);
  const form = useForm<SetScheduleInput>({
    resolver: zodResolver(setScheduleInput),
    defaultValues: scheduleFormDefaults(row, grid.week_start),
  });
  const past = (grid.days[day] ?? '') < branchCivilDate(grid.timezone, new Date());
  const submit = form.handleSubmit(async (input) => {
    if (past && !input.reason?.trim()) {
      form.setError('reason', { message: t(locale, 'shell.schedule_pastReason') });
      return;
    }
    try {
      await save.mutateAsync(input);
      onClose();
    } catch {
      /* حالة الرفض تبقى ظاهرة وتحتاج قرار المدير؛ لا يعاد الحفظ تلقائياً. */
    }
  });
  return { save, form, past, submit };
}
