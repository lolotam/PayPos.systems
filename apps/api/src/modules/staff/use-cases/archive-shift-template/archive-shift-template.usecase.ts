import { nextScheduleRevision } from '../../domain/schedules.ts';
import type {
  ScheduleActor,
  ScheduleClock,
  ScheduleTransactions,
} from '../../ports/schedules.port.ts';
/** يحتفظ بالقالب وتاريخه عند الأرشفة ولا يمس نسخه السابقة. */
export class ArchiveShiftTemplateUseCase {
  constructor(
    private readonly transactions: ScheduleTransactions,
    private readonly clock: ScheduleClock,
  ) {}
  execute(
    command: ScheduleActor & { businessId: string; templateId: string; expectedRevision: number },
  ) {
    return this.transactions.run(command, async (scope) => {
      await scope.business(command.businessId, 'manage');
      const before = await scope.template(command.businessId, command.templateId);
      const revision = nextScheduleRevision(before.revision, command.expectedRevision);
      const after = {
        ...before,
        revision,
        archived_at: before.archived_at ?? this.clock.now().toISOString(),
      };
      await scope.saveTemplate(before, after);
      return after;
    });
  }
}
