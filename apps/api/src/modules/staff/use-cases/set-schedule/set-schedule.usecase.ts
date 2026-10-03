import type { SetScheduleInput } from '@pospay/contracts';
import { scheduleToday } from '../../domain/schedule-calendar.ts';
import {
  materializeSchedule,
  nextScheduleRevision,
  requirePastScheduleReason,
  validateScheduleEmployee,
  validateScheduleEmployeeWeek,
  validateScheduleOverlap,
} from '../../domain/schedules.ts';
import type {
  ScheduleActor,
  ScheduleClock,
  ScheduleIds,
  ScheduleTransactions,
} from '../../ports/schedules.port.ts';
export { ScheduleError } from '../../domain/schedule-types.ts';

/** يثبت أسبوع الموظف والنسخة والسبب ثم يحفظ الجدول وتدقيقه ذرياً. */
export class SetScheduleUseCase {
  constructor(
    private readonly transactions: ScheduleTransactions,
    private readonly ids: ScheduleIds,
    private readonly clock: ScheduleClock,
  ) {}
  execute(
    command: ScheduleActor & {
      businessId: string;
      branchId: string;
      employeeId: string;
      input: SetScheduleInput;
    },
  ) {
    return this.transactions.run(command, async (scope) => {
      const { businessId, branchId, employeeId, input } = command;
      const context = await scope.branch(businessId, branchId);
      const current = await scope.employeeWeek(businessId, branchId, employeeId, input.week_start);
      validateScheduleEmployeeWeek(current.employee, branchId, input.week_start);
      const revision = nextScheduleRevision(current.before?.revision ?? 0, input.expected_revision);
      const shifts = materializeSchedule(input.week_start, input.shifts, context.timezone);
      validateScheduleEmployee(current.employee, branchId, shifts);
      validateScheduleOverlap(shifts, current.others);
      requirePastScheduleReason(
        current.before?.shifts ?? [],
        shifts,
        scheduleToday(this.clock.now(), context.timezone),
        input.reason,
      );
      const after = {
        id: current.before?.id ?? this.ids.newId(),
        business_id: businessId,
        branch_id: branchId,
        employee_id: employeeId,
        week_start: input.week_start,
        timezone: context.timezone,
        revision,
        shifts,
      };
      await scope.saveWeek(current.before, after, input.reason);
      return after;
    });
  }
}
