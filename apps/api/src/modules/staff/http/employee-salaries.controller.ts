import {
  Body,
  Controller,
  Get,
  Post,
  HttpCode,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  id,
  setSalaryInput,
  salaryHistoryQuery,
  type SetSalaryInput,
  type SalaryHistoryQuery,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  salaryHistory,
  SALARY_ACCESS,
  type SalaryAccess,
} from '../queries/salary-history.query.ts';
import { SetSalaryUseCase, SalaryError } from '../use-cases/set-salary/set-salary.usecase.ts';
@Controller('businesses/:businessId/employees/:employeeId/salaries')
export class EmployeeSalariesController {
  constructor(
    @Inject(SetSalaryUseCase) private readonly setSalary: SetSalaryUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(SALARY_ACCESS) private readonly access: SalaryAccess | null,
  ) {}
  @Post()
  @HttpCode(200)
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async set(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Body(new ZodValidationPipe(setSalaryInput)) input: SetSalaryInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.setSalary === null) throw new ApiError('NOT_READY');
    try {
      return await this.setSalary.execute({
        ...actorOf(request),
        businessId,
        employeeId,
        input,
        ...idem,
      });
    } catch (error) {
      if (error instanceof SalaryError) throw new ApiError(error.code);
      throw error;
    }
  }
  @Get()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async history(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Query(new ZodValidationPipe(salaryHistoryQuery)) query: SalaryHistoryQuery,
    @Req() request: FastifyRequest,
  ) {
    if (this.database === null || this.access === null) throw new ApiError('NOT_READY');
    const context = { ...actorOf(request), businessId, employeeId };
    const access = this.access;
    const result = await this.database.withTenant(
      context.companyId,
      (tx) => salaryHistory(tx, context, query, access),
      { userId: context.userId },
    );
    if (result === null) throw new ApiError('NOT_FOUND');
    if (result === 'FEATURE_DISABLED') throw new ApiError('FEATURE_DISABLED');
    return result;
  }
}
