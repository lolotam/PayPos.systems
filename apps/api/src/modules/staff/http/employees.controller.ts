import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { CreateEmployeeInput, Employee } from '@pospay/contracts';
import { id } from '@pospay/contracts';
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

@Controller('businesses/:businessId/employees')
export class EmployeesController {
  constructor(
    @Inject(CreateEmployeeUseCase) private readonly createEmployee: CreateEmployeeUseCase | null,
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
  detail(@Req() request: EmployeeDetailRequest): Employee {
    const record = request.employeeRecord;
    if (record === undefined) throw new ApiError('NOT_FOUND');
    return record;
  }
}
