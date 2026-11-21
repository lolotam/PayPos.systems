import { Controller, Get, Header, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  commissionEstimatePeriod,
  commissionEstimateQuery,
  id,
  type CommissionEstimate,
  type CommissionEstimateQuery,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  CommissionEstimateError,
} from '../use-cases/get-commission-estimate/get-commission-estimate.usecase.ts';
import type { GetCommissionEstimateUseCase } from '../use-cases/get-commission-estimate/get-commission-estimate.usecase.ts';

export const GET_COMMISSION_ESTIMATE = Symbol('GET_COMMISSION_ESTIMATE');

// CS-Q20: القراءة ما تستعملش @Require على مستوى النشاط، لأن صلاحية القارئ ممكن
// تكون على مستوى الفرع نفسه والحارس على مستوى النشاط بيقبلها ويرفض قارئ الفرع.
// فالنطاق بيتحل جوّه معاملة القراءة، والرفض الموحّد بييجي من هناك.
@Controller('businesses/:businessId/commissions/periods/:period/estimate')
export class CommissionEstimateController {
  constructor(
    @Inject(GET_COMMISSION_ESTIMATE)
    private readonly useCase: GetCommissionEstimateUseCase | null,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async estimate(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('period', new ZodValidationPipe(commissionEstimatePeriod)) period: string,
    @Query(new ZodValidationPipe(commissionEstimateQuery)) query: CommissionEstimateQuery,
    @Req() request: FastifyRequest,
  ): Promise<CommissionEstimate> {
    if (this.useCase === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    try {
      return await this.useCase.execute({
        companyId: actor.companyId,
        userId: actor.userId,
        businessId,
        period,
        employeeId: query.employee_id ?? null,
      });
    } catch (error) {
      if (error instanceof CommissionEstimateError) throw new ApiError(error.code);
      throw error;
    }
  }
}
