import {
  effectiveMaxShiftsPerDay,
  scheduleSettingsSource,
} from '../../domain/schedule-settings.ts';
import type { ScheduleActor } from '../../ports/schedules.port.ts';
import type { ScheduleSettingsTransactions } from '../../ports/schedule-settings.port.ts';

/** يعيد الفرع إلى حد النشاط دون كتابة أو تدقيق عند غياب قيمة خاصة. */
export class ClearBranchScheduleSettingsUseCase {
  constructor(private readonly transactions: ScheduleSettingsTransactions) {}
  execute(command: ScheduleActor & { businessId: string; branchId: string }) {
    return this.transactions.run(command, async (scope) => {
      await scope.authorize(command.businessId);
      await scope.branch(command.businessId, command.branchId);
      const before = await scope.branchSettings(command.businessId, command.branchId);
      if (before.max_shifts_per_day !== null) await scope.clearBranch(before);
      return {
        branch_id: before.branch_id,
        max_shifts_per_day: effectiveMaxShiftsPerDay(null, before.business_value),
        source: scheduleSettingsSource(null, before.business_value),
        updated_at: null,
      };
    });
  }
}
