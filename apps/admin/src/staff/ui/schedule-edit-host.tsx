'use client';
import type { ScheduleGrid } from '@pospay/contracts';
import { ScheduleLimitContext } from '../model/schedule-form';
import { ScheduleEditDialog } from './schedule-edit-dialog';
import type { ScheduleWorkspace } from '../api/use-schedules';

type ScheduleEdit = { row: ScheduleGrid['items'][number]; day: number };

/** نافذة تعديل الوردية: تُفتح فوق الصفحة وتقرأ حد الورديات من قراءة الأسبوع نفسها. */
export function ScheduleEditHost({
  scope,
  week,
  edit,
  grid,
  onClose,
}: {
  scope: ScheduleWorkspace;
  week: string;
  edit: ScheduleEdit | undefined;
  grid: ScheduleGrid | undefined;
  onClose: () => void;
}) {
  if (edit === undefined || grid === undefined) return null;
  return (
    <ScheduleLimitContext value={grid.max_shifts_per_day}>
      <ScheduleEditDialog
        key={`${edit.row.employee_id}:${week}:${edit.day}`}
        scope={scope}
        row={edit.row}
        day={edit.day}
        grid={grid}
        onClose={onClose}
      />
    </ScheduleLimitContext>
  );
}
