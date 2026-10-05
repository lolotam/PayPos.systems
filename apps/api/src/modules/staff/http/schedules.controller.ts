import { Body, Controller, Get, Inject, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import {
  id,
  scheduleListQuery,
  scheduleWeekQuery,
  setScheduleInput,
  type ScheduleListQuery,
  type SetScheduleInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  branchScheduleWeek,
  employeeScheduleWeek,
  SCHEDULE_READ_ACCESS,
  type ScheduleReadAccess,
} from '../queries/schedule-week.query.ts';
import { SetScheduleUseCase } from '../use-cases/set-schedule/set-schedule.usecase.ts';
import { scheduleHttpResult } from './schedule-errors.ts';

@Controller('businesses/:businessId/branches/:branchId/schedules')
export class SchedulesController {
  constructor(
    @Inject(SetScheduleUseCase) private readonly setSchedule: SetScheduleUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(SCHEDULE_READ_ACCESS) private readonly access: ScheduleReadAccess,
  ) {}
  @Get()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async list(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Query(new ZodValidationPipe(scheduleListQuery)) query: ScheduleListQuery,
    @Req() request: FastifyRequest,
  ) {
    if (!this.database) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const result = await this.database.withTenant(
      actor.companyId,
      (tx) =>
        branchScheduleWeek(
          tx,
          actor.companyId,
          actor.userId,
          businessId,
          branchId,
          query,
          this.access,
        ),
      { userId: actor.userId },
    );
    if (typeof result === 'string') throw new ApiError(result);
    return result;
  }
  @Get(':employeeId')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async detail(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Query(new ZodValidationPipe(scheduleWeekQuery)) query: { week_start: string },
    @Req() request: FastifyRequest,
  ) {
    if (!this.database) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const result = await this.database.withTenant(
      actor.companyId,
      (tx) =>
        employeeScheduleWeek(
          tx,
          actor.companyId,
          actor.userId,
          businessId,
          branchId,
          employeeId,
          query.week_start,
          this.access,
        ),
      { userId: actor.userId },
    );
    if (typeof result === 'string') throw new ApiError(result);
    return result;
  }
  @Put(':employeeId')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  set(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Body(new ZodValidationPipe(setScheduleInput)) input: SetScheduleInput,
    @Req() request: FastifyRequest,
  ) {
    if (!this.setSchedule) throw new ApiError('NOT_READY');
    return scheduleHttpResult(
      this.setSchedule.execute({ ...actorOf(request), businessId, branchId, employeeId, input }),
    );
  }
}
