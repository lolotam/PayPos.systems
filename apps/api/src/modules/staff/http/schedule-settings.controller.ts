import { Body, Controller, Get, Inject, Param, Put, Req, UseGuards } from '@nestjs/common';
import { id, setScheduleSettingsInput, type SetScheduleSettingsInput } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  getScheduleSettings,
  SCHEDULE_SETTINGS_ACCESS,
  type ScheduleSettingsAccess,
} from '../queries/schedule-settings.query.ts';
import { SetScheduleSettingsUseCase } from '../use-cases/set-schedule-settings/set-schedule-settings.usecase.ts';
import { scheduleHttpResult } from './schedule-errors.ts';

@Controller('businesses/:businessId/schedule-settings')
export class ScheduleSettingsController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(SCHEDULE_SETTINGS_ACCESS) private readonly access: ScheduleSettingsAccess,
    @Inject(SetScheduleSettingsUseCase)
    private readonly setSettings: SetScheduleSettingsUseCase | null,
  ) {}
  @Get()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async get(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!this.database) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const result = await this.database.withTenant(
      actor.companyId,
      (tx) => getScheduleSettings(tx, actor.companyId, actor.userId, businessId, this.access),
      { userId: actor.userId },
    );
    if (typeof result === 'string') throw new ApiError(result);
    return result;
  }
  @Put()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  set(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new ZodValidationPipe(setScheduleSettingsInput)) input: SetScheduleSettingsInput,
    @Req() request: FastifyRequest,
  ) {
    if (!this.setSettings) throw new ApiError('NOT_READY');
    return scheduleHttpResult(this.setSettings.execute({ ...actorOf(request), businessId, input }));
  }
}
