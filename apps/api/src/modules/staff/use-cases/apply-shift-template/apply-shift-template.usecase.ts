import type { ApplyTemplateInput } from '@pospay/contracts';
import { scheduleToday } from '../../domain/schedule-calendar.ts';
import {
  requireActiveTemplate,
  requireTemplateReplacement,
  validateTemplateWeeks,
  validateTemplateBatch,
} from '../../domain/schedule-templates.ts';
import type { ScheduleRecord } from '../../domain/schedule-types.ts';
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
  ScheduleScope,
  ScheduleTarget,
  ScheduleTransactions,
} from '../../ports/schedules.port.ts';

/** ينسخ نمط القالب لأهداف صريحة ويمنع تطبيقاً جزئياً أو استبدالاً غير مقصود. */
export class ApplyShiftTemplateUseCase {
  constructor(
    private readonly transactions: ScheduleTransactions,
    private readonly ids: ScheduleIds,
    private readonly clock: ScheduleClock,
  ) {}
  execute(
    command: ScheduleActor & { businessId: string; templateId: string; input: ApplyTemplateInput },
  ) {
    return this.transactions.run(command, async (scope) => {
      await scope.business(command.businessId, 'read');
      const context = await scope.branch(command.businessId, command.input.branch_id);
      const template = await scope.template(command.businessId, command.templateId);
      validateTemplateWeeks(command.input.weeks);
      validateTemplateBatch(command.input.employee_ids.length, command.input.weeks.length);
      const targets = await this.loadTargets(scope, command);
      for (const target of targets)
        validateScheduleEmployeeWeek(target.employee, command.input.branch_id, target.weekStart);
      requireActiveTemplate(template);
      requireTemplateReplacement(
        targets.flatMap((t) => (t.before ? [t.before] : [])),
        command.input.replace,
        command.input.reason,
      );
      // نفس الأسبوع والمنطقة لهما نفس اللحظات لكل الموظفين؛ التحويل يحسب مرة واحدة.
      const patterns = new Map(
        command.input.weeks.map((week) => [
          week,
          materializeSchedule(week, template.shifts, context.timezone),
        ]),
      );
      const today = scheduleToday(this.clock.now(), context.timezone);
      const plans = targets.map((target) =>
        this.plan(command, context.timezone, patterns.get(target.weekStart) ?? [], today, target),
      );
      for (const plan of plans)
        validateScheduleOverlap(
          plan.after.shifts,
          plans
            .filter((p) => p !== plan && p.after.employee_id === plan.after.employee_id)
            .flatMap((p) => p.after.shifts),
        );
      await scope.saveWeeks(plans, command.input.reason);
      return { schedules: plans.map((p) => p.after) };
    });
  }
  private async loadTargets(
    scope: ScheduleScope,
    command: ScheduleActor & { businessId: string; input: ApplyTemplateInput },
  ) {
    return scope.employeeWeeks(
      command.businessId,
      command.input.branch_id,
      command.input.employee_ids,
      command.input.weeks,
    );
  }
  private plan(
    command: { businessId: string; input: ApplyTemplateInput },
    timezone: string,
    shifts: ScheduleRecord['shifts'],
    today: string,
    target: ScheduleTarget,
  ): { before: ScheduleRecord | null; after: ScheduleRecord } {
    validateScheduleEmployee(target.employee, command.input.branch_id, shifts);
    // الأسابيع التي سيستبدلها التطبيق تستبعد من المقارنة؛ تقارن النسخ الجديدة ببعضها لاحقاً.
    const others = target.others.filter(
      (s) =>
        !(s.branch_id === command.input.branch_id && command.input.weeks.includes(s.week_start)),
    );
    validateScheduleOverlap(shifts, others);
    requirePastScheduleReason(target.before?.shifts ?? [], shifts, today, command.input.reason);
    return {
      before: target.before,
      after: {
        id: target.before?.id ?? this.ids.newId(),
        employee_id: target.employee.id,
        branch_id: command.input.branch_id,
        business_id: command.businessId,
        week_start: target.weekStart,
        timezone,
        shifts,
        revision: nextScheduleRevision(target.before?.revision ?? 0, target.before?.revision ?? 0),
      },
    };
  }
}
