import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { CreateEmployeeInput, Employee } from '@pospay/contracts';
import { id } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { employeeDetail } from '../queries/employee-detail.query.ts';
import {
  CreateEmployeeUseCase,
  EmployeeCreationError,
} from '../use-cases/create-employee/create-employee.usecase.ts';
import { EmployeeInputPipe } from './employee-input.pipe.ts';

@Controller('businesses/:businessId/employees')
export class EmployeesController {
  constructor(
    @Inject(CreateEmployeeUseCase) private readonly createEmployee: CreateEmployeeUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
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
  @Require('manage:employees:business', { business: 'businessId' })
  @RequiresFeature('staff')
  async detail(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Req() request: FastifyRequest,
  ): Promise<Employee> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const record = await this.database.withTenant(
      actor.companyId,
      (tx) => employeeDetail(tx, actor.companyId, businessId, employeeId),
      { userId: actor.userId },
    );
    if (record === null) throw new ApiError('NOT_FOUND');
    return record;
  }
}
