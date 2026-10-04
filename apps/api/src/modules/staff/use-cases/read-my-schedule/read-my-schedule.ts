import { validateScheduleWeek } from '../../domain/schedule-calendar.ts';

// التحقق التقويمي يبقى في domain ولا يتكرر في SQL أو controller.
export function validateMyScheduleWeek(week: string): boolean {
  try {
    validateScheduleWeek(week);
    return true;
  } catch {
    return false;
  }
}
