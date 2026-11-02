import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import {
  commissionPlanEmployeeListQuery,
  id,
  type CommissionPlanEmployeeList,
  type CommissionPlanEmployeeListQuery,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  COMMISSION_PLAN_EMPLOYEE_LIST,
  CommissionPlanEmployeeReadError,
  type CommissionPlanEmployeeListRunner,
} from '../queries/commission-plan-employees.query.ts';

function mapReadError(error: unknown): never {
  if (error instanceof CommissionPlanEmployeeReadError) {
    throw new ApiError(error.code);
  }
  throw error;
}

@Controller('businesses/:businessId/commission-plan-employees')
export class CommissionPlanEmployeesController {
  constructor(
    @Inject(COMMISSION_PLAN_EMPLOYEE_LIST)
    private readonly runner: CommissionPlanEmployeeListRunner | null,
  ) {}

  @Get()
  @Require('manage:commission-plans:business', { business: 'businessId' })
  @RequiresFeature('commissions')
  async listPlanEmployees(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Query(new ZodValidationPipe(commissionPlanEmployeeListQuery))
    query: CommissionPlanEmployeeListQuery,
    @Req() request: FastifyRequest,
  ): Promise<CommissionPlanEmployeeList> {
    if (this.runner === null) throw new ApiError('NOT_READY');
    try {
      return await this.runner(actorOf(request), businessId, query);
    } catch (error) {
      return mapReadError(error);
    }
  }
}
