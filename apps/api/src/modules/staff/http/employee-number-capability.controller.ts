import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  employeeNumberCapability,
  employeeNumberCapabilityQuery,
  id,
  type EmployeeNumberCapabilityQuery,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  EmployeeCreationError,
  ReadEmployeeNumberCapabilityUseCase,
} from '../use-cases/read-employee-number-capability/read-employee-number-capability.usecase.ts';

@Controller('businesses/:businessId/employee-number-capability')
export class EmployeeNumberCapabilityController {
  constructor(
    @Inject(ReadEmployeeNumberCapabilityUseCase)
    private readonly readCapability: ReadEmployeeNumberCapabilityUseCase | null,
  ) {}

  @Get()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async read(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Query(new ZodValidationPipe(employeeNumberCapabilityQuery)) query: EmployeeNumberCapabilityQuery,
    @Req() request: FastifyRequest,
  ) {
    if (this.readCapability === null) throw new ApiError('NOT_READY');
    try {
      return employeeNumberCapability.parse(
        await this.readCapability.execute({
          ...actorOf(request),
          businessId,
          primaryBranchId: query.primary_branch_id,
        }),
      );
    } catch (error) {
      if (error instanceof EmployeeCreationError) throw new ApiError(error.code);
      throw error;
    }
  }
}
