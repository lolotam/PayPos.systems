import { Body, Controller, Delete, Inject, Param, Put, Req, UseGuards } from '@nestjs/common';
import { id, setScheduleSettingsInput, type SetScheduleSettingsInput } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { SetBranchScheduleSettingsUseCase } from '../use-cases/set-branch-schedule-settings/set-branch-schedule-settings.usecase.ts';
import { ClearBranchScheduleSettingsUseCase } from '../use-cases/clear-branch-schedule-settings/clear-branch-schedule-settings.usecase.ts';
import { scheduleHttpResult } from './schedule-errors.ts';

@Controller('businesses/:businessId/branches/:branchId/schedule-settings')
export class BranchScheduleSettingsController {
  constructor(
    @Inject(SetBranchScheduleSettingsUseCase)
    private readonly setSettings: SetBranchScheduleSettingsUseCase | null,
    @Inject(ClearBranchScheduleSettingsUseCase)
    private readonly clearSettings: ClearBranchScheduleSettingsUseCase | null,
  ) {}
  @Put()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  set(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Body(new ZodValidationPipe(setScheduleSettingsInput)) input: SetScheduleSettingsInput,
    @Req() request: FastifyRequest,
  ) {
    if (!this.setSettings) throw new ApiError('NOT_READY');
    return scheduleHttpResult(
      this.setSettings.execute({ ...actorOf(request), businessId, branchId, input }),
    );
  }
  @Delete()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  clear(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!this.clearSettings) throw new ApiError('NOT_READY');
    return scheduleHttpResult(
      this.clearSettings.execute({ ...actorOf(request), businessId, branchId }),
    );
  }
}
