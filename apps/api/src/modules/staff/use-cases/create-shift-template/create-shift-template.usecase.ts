import type { TemplateTerms } from '@pospay/contracts';
import { validateSchedulePattern } from '../../domain/schedules.ts';
import type {
  ScheduleActor,
  ScheduleIds,
  ScheduleTransactions,
} from '../../ports/schedules.port.ts';
/** ينشئ نمطاً باسم في النشاط دون كتابة أي جدول موظف. */
export class CreateShiftTemplateUseCase {
  constructor(
    private readonly transactions: ScheduleTransactions,
    private readonly ids: ScheduleIds,
  ) {}
  execute(command: ScheduleActor & { businessId: string; input: TemplateTerms }) {
    return this.transactions.run(command, async (scope) => {
      await scope.business(command.businessId, 'manage');
      const limit = await scope.templateMaxShiftsPerDay(command.businessId);
      const shifts = validateSchedulePattern(command.input.shifts, limit);
      const after = {
        ...command.input,
        name_ar: command.input.name_ar ?? null,
        shifts,
        id: this.ids.newId(),
        business_id: command.businessId,
        revision: 1,
        archived_at: null,
      };
      await scope.saveTemplate(null, after);
      return after;
    });
  }
}
