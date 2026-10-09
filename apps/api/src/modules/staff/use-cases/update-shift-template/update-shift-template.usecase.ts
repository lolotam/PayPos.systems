import { changedPatternDays } from '../../domain/schedule-settings.ts';
import type { UpdateTemplateInput } from '@pospay/contracts';
import { requireActiveTemplate } from '../../domain/schedule-templates.ts';
import { nextScheduleRevision, validateSchedulePattern } from '../../domain/schedules.ts';
import type { ScheduleActor, ScheduleTransactions } from '../../ports/schedules.port.ts';
/** يعدل النمط فقط؛ الجداول المطبقة نسخ مستقلة لا تتغير معه. */
export class UpdateShiftTemplateUseCase {
  constructor(private readonly transactions: ScheduleTransactions) {}
  execute(
    command: ScheduleActor & { businessId: string; templateId: string; input: UpdateTemplateInput },
  ) {
    return this.transactions.run(command, async (scope) => {
      await scope.business(command.businessId, 'manage');
      const before = await scope.template(command.businessId, command.templateId);
      requireActiveTemplate(before);
      const revision = nextScheduleRevision(before.revision, command.input.expected_revision);
      const limit = await scope.maxShiftsPerDay(command.businessId);
      const shifts = validateSchedulePattern(
        command.input.shifts, limit, changedPatternDays(before.shifts, command.input.shifts),
      );
      const after = {
        ...before,
        name_en: command.input.name_en,
        name_ar: command.input.name_ar ?? null,
        revision,
        shifts,
      };
      await scope.saveTemplate(before, after);
      return after;
    });
  }
}
