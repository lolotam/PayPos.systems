import type { SetScheduleSettingsInput } from '@pospay/contracts';
import {
  effectiveMaxShiftsPerDay,
  scheduleSettingsSource,
  validateMaxShiftsPerDay,
} from '../../domain/schedule-settings.ts';
import type { ScheduleActor, ScheduleClock } from '../../ports/schedules.port.ts';
import type { ScheduleSettingsTransactions } from '../../ports/schedule-settings.port.ts';

/** يحفظ حد الفرع الخاص بعد الإذن والقفل؛ تكرار قيمته لا يكتب أو يدقق. */
export class SetBranchScheduleSettingsUseCase {
  constructor(
    private readonly transactions: ScheduleSettingsTransactions,
    private readonly clock: ScheduleClock,
  ) {}
  execute(
    command: ScheduleActor & {
      businessId: string;
      branchId: string;
      input: SetScheduleSettingsInput;
    },
  ) {
    return this.transactions.run(command, async (scope) => {
      validateMaxShiftsPerDay(command.input.max_shifts_per_day);
      await scope.authorize(command.businessId);
      await scope.branch(command.businessId, command.branchId);
      const before = await scope.branchSettings(command.businessId, command.branchId);
      const changed = before.max_shifts_per_day !== command.input.max_shifts_per_day;
      const after = changed
        ? {
            ...before,
            max_shifts_per_day: command.input.max_shifts_per_day,
            updated_at: this.clock.now().toISOString(),
          }
        : before;
      if (changed) await scope.saveBranch(before, after);
      return {
        branch_id: after.branch_id,
        max_shifts_per_day: effectiveMaxShiftsPerDay(
          after.max_shifts_per_day,
          after.business_value,
        ),
        source: scheduleSettingsSource(after.max_shifts_per_day, after.business_value),
        updated_at: after.updated_at,
      };
    });
  }
}
