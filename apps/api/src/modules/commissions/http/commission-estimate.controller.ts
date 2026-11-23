import { Controller, Get, Header, Inject, Param, Query, Req } from '@nestjs/common';
import {
  commissionEstimatePeriod,
  commissionEstimateQuery,
  id,
  type CommissionEstimate,
  type CommissionEstimateQuery,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { ApiError } from '../../../shared/errors.ts';
import { COMPANY_HEADER } from '../../../shared/company-header.ts';
import { bindVerifiedCompany } from '../../../shared/request-context.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  CommissionEstimateError,
} from '../use-cases/get-commission-estimate/get-commission-estimate.usecase.ts';
import type { GetCommissionEstimateUseCase } from '../use-cases/get-commission-estimate/get-commission-estimate.usecase.ts';

export const GET_COMMISSION_ESTIMATE = Symbol('GET_COMMISSION_ESTIMATE');

/**
 * الشركة والمستخدم من الطلب: الشركة من هيدر العميل والمستخدم من الجلسة
 * الموثقة. إثبات العضوية والشركة بيحصل جوّه معاملة القراءة نفسها، فمفيش
 * معاملتين ولا حالة مقروءة بره اللقطة.
 */
export function commissionEstimateActor(request: FastifyRequest): {
  companyId: string;
  userId: string;
} {
  const principal = request.principal;
  if (principal?.kind !== 'user' || principal.userId === null) throw new ApiError('FORBIDDEN');
  const header = request.headers[COMPANY_HEADER];
  const parsed = id.safeParse(typeof header === 'string' ? header.toLowerCase() : header);
  if (!parsed.success) throw new ApiError('BAD_REQUEST');
  return { companyId: parsed.data, userId: principal.userId };
}

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
  async estimate(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('period', new ZodValidationPipe(commissionEstimatePeriod)) period: string,
    @Query(new ZodValidationPipe(commissionEstimateQuery)) query: CommissionEstimateQuery,
    @Req() request: FastifyRequest,
  ): Promise<CommissionEstimate> {
    if (this.useCase === null) throw new ApiError('NOT_READY');
    const actor = commissionEstimateActor(request);
    try {
      const estimate = await this.useCase.execute({
        companyId: actor.companyId,
        userId: actor.userId,
        businessId,
        period,
        employeeId: query.employee_id ?? null,
      });
      // الشركة بتتسجل في سياق السجل بعد إثبات العضوية جوّه المعاملة، فمش
      // بنسجل هيدر غير مثبوت.
      bindVerifiedCompany(actor.companyId);
      return estimate;
    } catch (error) {
      if (error instanceof CommissionEstimateError) throw new ApiError(error.code);
      throw error;
    }
  }
}
