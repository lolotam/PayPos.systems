import { Body, Controller, Get, Put, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  id,
  setEmployeeIbanInput,
  employeeIbanHistoryQuery,
  type SetEmployeeIbanInput,
  type EmployeeIbanHistoryQuery,
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
  employeeIban,
  EMPLOYEE_IBAN_ACCESS,
  type EmployeeIbanReadAccess,
} from '../queries/employee-iban.query.ts';
import { employeeIbanHistory } from '../queries/employee-iban-history.query.ts';
import {
  SetEmployeeIbanUseCase,
  EmployeeIbanError,
} from '../use-cases/set-employee-iban/set-employee-iban.usecase.ts';

@Controller('businesses/:businessId/employees/:employeeId/iban')
export class EmployeeIbanController {
  constructor(
    @Inject(SetEmployeeIbanUseCase) private readonly setIban: SetEmployeeIbanUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(EMPLOYEE_IBAN_ACCESS) private readonly access: EmployeeIbanReadAccess | null,
  ) {}

  @Put()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async set(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Body(new ZodValidationPipe(setEmployeeIbanInput)) input: SetEmployeeIbanInput,
    @Req() request: FastifyRequest,
  ) {
    if (!this.setIban) throw new ApiError('NOT_READY');
    try {
      return await this.setIban.execute({ ...actorOf(request), businessId, employeeId, input });
    } catch (error) {
      if (error instanceof EmployeeIbanError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Get()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async current(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!this.database || !this.access) throw new ApiError('NOT_READY');
    const context = { ...actorOf(request), businessId, employeeId };
    const access = this.access;
    const result = await this.database.withTenant(
      context.companyId,
      (tx) => employeeIban(tx, context, access),
      { userId: context.userId },
    );
    if (result === null) throw new ApiError('NOT_FOUND');
    if (result === 'FEATURE_DISABLED') throw new ApiError('FEATURE_DISABLED');
    return result;
  }

  @Get('history')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async history(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Query(new ZodValidationPipe(employeeIbanHistoryQuery)) query: EmployeeIbanHistoryQuery,
    @Req() request: FastifyRequest,
  ) {
    if (!this.database || !this.access) throw new ApiError('NOT_READY');
    const context = { ...actorOf(request), businessId, employeeId };
    const access = this.access;
    const result = await this.database.withTenant(
      context.companyId,
      (tx) => employeeIbanHistory(tx, context, query, access),
      { userId: context.userId },
    );
    if (result === null) throw new ApiError('NOT_FOUND');
    if (result === 'FEATURE_DISABLED') throw new ApiError('FEATURE_DISABLED');
    return result;
  }
}
