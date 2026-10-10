import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { systemClock } from '../../shared/adapters/system-clock.ts';
import { SetBranchScheduleSettingsUseCase } from './use-cases/set-branch-schedule-settings/set-branch-schedule-settings.usecase.ts';
import { ClearBranchScheduleSettingsUseCase } from './use-cases/clear-branch-schedule-settings/clear-branch-schedule-settings.usecase.ts';
import {
  createScheduleSettingsAccess,
  createScheduleSettingsTransactions,
} from './persistence/schedule-settings.adapter.ts';
import { SCHEDULE_SETTINGS_ACCESS } from './queries/schedule-settings.query.ts';
import { SetScheduleSettingsUseCase } from './use-cases/set-schedule-settings/set-schedule-settings.usecase.ts';
import { createScheduleTransactions } from './persistence/drizzle-schedules.ts';
import { createScheduleReadAccess } from './persistence/schedule-read-access.adapter.ts';
import { SCHEDULE_READ_ACCESS } from './queries/schedule-week.query.ts';
import { SetScheduleUseCase } from './use-cases/set-schedule/set-schedule.usecase.ts';
import { CreateShiftTemplateUseCase } from './use-cases/create-shift-template/create-shift-template.usecase.ts';
import { UpdateShiftTemplateUseCase } from './use-cases/update-shift-template/update-shift-template.usecase.ts';
import { ArchiveShiftTemplateUseCase } from './use-cases/archive-shift-template/archive-shift-template.usecase.ts';
import { ApplyShiftTemplateUseCase } from './use-cases/apply-shift-template/apply-shift-template.usecase.ts';

// ربط الجداول والقوالب والإعدادات منفصل عن وحدة staff كي تبقى الوحدة تحت حد حجم الملف.
export function scheduleProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
): Provider[] {
  const transactions = database === undefined ? null : createScheduleTransactions(database, ids);
  const settings =
    database === undefined ? null : createScheduleSettingsTransactions(database, ids);
  return [
    {
      provide: SetBranchScheduleSettingsUseCase,
      useValue:
        settings === null ? null : new SetBranchScheduleSettingsUseCase(settings, systemClock),
    },
    {
      provide: ClearBranchScheduleSettingsUseCase,
      useValue: settings === null ? null : new ClearBranchScheduleSettingsUseCase(settings),
    },
    { provide: SCHEDULE_SETTINGS_ACCESS, useValue: createScheduleSettingsAccess() },
    {
      provide: SetScheduleSettingsUseCase,
      useValue:
        database === undefined
          ? null
          : new SetScheduleSettingsUseCase(
              createScheduleSettingsTransactions(database, ids),
              systemClock,
            ),
    },
    { provide: SCHEDULE_READ_ACCESS, useValue: createScheduleReadAccess() },
    {
      provide: SetScheduleUseCase,
      useValue:
        transactions === null ? null : new SetScheduleUseCase(transactions, ids, systemClock),
    },
    {
      provide: CreateShiftTemplateUseCase,
      useValue: transactions === null ? null : new CreateShiftTemplateUseCase(transactions, ids),
    },
    {
      provide: UpdateShiftTemplateUseCase,
      useValue: transactions === null ? null : new UpdateShiftTemplateUseCase(transactions),
    },
    {
      provide: ArchiveShiftTemplateUseCase,
      useValue:
        transactions === null ? null : new ArchiveShiftTemplateUseCase(transactions, systemClock),
    },
    {
      provide: ApplyShiftTemplateUseCase,
      useValue:
        transactions === null
          ? null
          : new ApplyShiftTemplateUseCase(transactions, ids, systemClock),
    },
  ];
}
