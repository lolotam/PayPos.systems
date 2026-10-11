import { Body, Controller, Get, Put, Inject, Param, Req, UseGuards } from '@nestjs/common';
import { id, setEmployeeDefaultShiftsInput, type SetEmployeeDefaultShiftsInput } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated, Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { EmployeeDetailGuard } from './employee-detail.guard.ts';
import { employeeDefaultShifts, EMPLOYEE_HOURS_READ_ACCESS, type EmployeeHoursReadAccess,
  type EmployeeHoursReadContext } from '../queries/employee-default-shifts.query.ts';
import { SetEmployeeDefaultShiftsUseCase, EmployeeDefaultShiftsError, ScheduleError }
  from '../use-cases/set-employee-default-shifts/set-employee-default-shifts.usecase.ts';

@Controller('businesses/:businessId/employees/:employeeId')
export class EmployeeDefaultShiftsController {
  constructor(
    @Inject(SetEmployeeDefaultShiftsUseCase) private readonly setHours: SetEmployeeDefaultShiftsUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(EMPLOYEE_HOURS_READ_ACCESS) private readonly access: EmployeeHoursReadAccess | null,
  ) {}

  @Get('default-shifts')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard, EmployeeDetailGuard)
  current(@Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Req() request: FastifyRequest) {
    return this.read({ ...actorOf(request), businessId, employeeId });
  }

  @Put('branches/:branchId/default-shifts')
  @Require('manage:employee-hours:business', { business: 'businessId' })
  @RequiresFeature('staff')
  async set(@Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Body(new ZodValidationPipe(setEmployeeDefaultShiftsInput)) input: SetEmployeeDefaultShiftsInput,
    @Req() request: FastifyRequest) {
    if (!this.setHours) throw new ApiError('NOT_READY');
    const context = { ...actorOf(request), businessId, employeeId };
    try {
      await this.setHours.execute({ ...context, branchId, input });
      return await this.read(context, true);
    } catch (error) {
      if (error instanceof ScheduleError) throw new ApiError(error.code, error.details);
      if (error instanceof EmployeeDefaultShiftsError)
        throw new ApiError(error.code);
      throw error;
    }
  }

  private async read(context: EmployeeHoursReadContext, forManager = false) {
    if (!this.database || !this.access) throw new ApiError('NOT_READY');
    const access = this.access;
    const result = await this.database.withTenant(context.companyId,
      (tx) => employeeDefaultShifts(tx, context, access, forManager), { userId: context.userId });
    if (result === null) throw new ApiError('NOT_FOUND');
    if (result === 'FEATURE_DISABLED') throw new ApiError('FEATURE_DISABLED');
    return result;
  }
}
