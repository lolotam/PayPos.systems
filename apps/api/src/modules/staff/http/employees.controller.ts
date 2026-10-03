import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Query,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type {
  CreateEmployeeInput,
  Employee,
  EmployeeDetail,
  EmployeeListQuery,
  UpdateEmployeeInput,
  EmployeePage,
} from '@pospay/contracts';
import { id, employeeListQuery, updateEmployeeInput } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Authenticated, Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { EmployeeDetailGuard, type EmployeeDetailRequest } from './employee-detail.guard.ts';
import {
  CreateEmployeeUseCase,
  EmployeeCreationError,
} from '../use-cases/create-employee/create-employee.usecase.ts';
import { EmployeeInputPipe } from './employee-input.pipe.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import {
  EMPLOYEE_DETAIL_ACCESS,
  type EmployeeDetailAccess,
} from '../queries/employee-detail.query.ts';
import { listEmployees } from '../queries/list-employees.query.ts';
import { UpdateEmployeeUseCase } from '../use-cases/update-employee/update-employee.usecase.ts';

@Controller('businesses/:businessId/employees')
export class EmployeesController {
  constructor(
    @Inject(CreateEmployeeUseCase) private readonly createEmployee: CreateEmployeeUseCase | null,
    @Inject(UpdateEmployeeUseCase) private readonly updateEmployee: UpdateEmployeeUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(EMPLOYEE_DETAIL_ACCESS) private readonly access: EmployeeDetailAccess | null,
  ) {}

  @Post()
  @HttpCode(201)
  @Require('manage:employees:business', { business: 'businessId' })
  @RequiresFeature('staff')
  async create(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new EmployeeInputPipe()) input: CreateEmployeeInput,
    @Req() request: FastifyRequest,
  ): Promise<Employee> {
    if (this.createEmployee === null) throw new ApiError('NOT_READY');
    try {
      return await this.createEmployee.execute({ ...actorOf(request), businessId, input });
    } catch (error) {
      if (error instanceof EmployeeCreationError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Get(':employeeId')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard, EmployeeDetailGuard)
  detail(@Req() request: EmployeeDetailRequest): EmployeeDetail {
    const record = request.employeeRecord;
    if (record === undefined) throw new ApiError('NOT_FOUND');
    return record;
  }

  @Get()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async list(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Query(new ZodValidationPipe(employeeListQuery)) query: EmployeeListQuery,
    @Req() request: FastifyRequest,
  ): Promise<EmployeePage> {
    if (this.database === null || this.access === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const access = this.access;
    const page = await this.database.withTenant(
      actor.companyId,
      (tx) => listEmployees(tx, actor.companyId, businessId, actor.userId, query, access),
      { userId: actor.userId },
    );
    if (page === 'FEATURE_DISABLED') throw new ApiError('FEATURE_DISABLED');
    return page;
  }

  @Patch(':employeeId')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async update(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Body(new ZodValidationPipe(updateEmployeeInput)) input: UpdateEmployeeInput,
    @Req() request: FastifyRequest,
  ): Promise<EmployeeDetail> {
    if (this.updateEmployee === null) throw new ApiError('NOT_READY');
    try {
      return await this.updateEmployee.execute({
        ...actorOf(request),
        businessId,
        employeeId,
        input,
      });
    } catch (error) {
      if (error instanceof EmployeeCreationError) throw new ApiError(error.code);
      throw error;
    }
  }
}
