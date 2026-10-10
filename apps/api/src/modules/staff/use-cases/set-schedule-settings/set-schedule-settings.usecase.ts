import type { SetScheduleSettingsInput } from '@pospay/contracts';
import { validateMaxShiftsPerDay } from '../../domain/schedule-settings.ts';
import type { ScheduleActor, ScheduleClock } from '../../ports/schedules.port.ts';
import type { ScheduleSettingsTransactions } from '../../ports/schedule-settings.port.ts';

/** يغير حد النشاط بعد تثبيت الإذن، ولا يكتب أو يدقق القيمة نفسها. */
export class SetScheduleSettingsUseCase {
  constructor(
    private readonly transactions: ScheduleSettingsTransactions,
    private readonly clock: ScheduleClock,
  ) {}
  execute(command: ScheduleActor & { businessId: string; input: SetScheduleSettingsInput }) {
    return this.transactions.run(command, async (scope) => {
      validateMaxShiftsPerDay(command.input.max_shifts_per_day);
      await scope.authorize(command.businessId);
      const before = await scope.settings(command.businessId);
      if (before.max_shifts_per_day === command.input.max_shifts_per_day) return before;
      const after = {
        business_id: command.businessId,
        max_shifts_per_day: command.input.max_shifts_per_day,
        is_default: false,
        updated_at: this.clock.now().toISOString(),
      };
      await scope.save(before, after);
      return after;
    });
  }
}
