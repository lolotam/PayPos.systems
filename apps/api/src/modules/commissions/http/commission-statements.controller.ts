import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import {
  commissionEstimatePeriod,
  commissionStatementBranchView,
  commissionStatementView,
  commissionStatementPeriod,
  id,
  markCommissionStatementPaidInput,
  markCommissionStatementPaidResponse,
  type CommissionStatementBranchView,
  type CommissionStatementView,
  type MarkCommissionStatementPaidInput,
  type MarkCommissionStatementPaidResponse,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Authenticated, Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { bindVerifiedCompany } from '../../../shared/request-context.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { GenerateCommissionStatementUseCase } from '../use-cases/generate-statement/generate-statement.usecase.ts';
import type { GetCommissionStatementUseCase } from '../use-cases/get-statement/get-statement.usecase.ts';
import { MarkCommissionStatementPaidUseCase } from '../use-cases/mark-statement-paid/mark-statement-paid.usecase.ts';
import { commissionEstimateActor } from './commission-estimate.controller.ts';
import { mapCommissionWriteError } from './commission-input-errors.ts';

export const GET_COMMISSION_STATEMENT = Symbol('GET_COMMISSION_STATEMENT');

// القراءة بـ @Authenticated زي التقدير: صلاحية القارئ ممكن تكون على مستوى الفرع، فالنطاق بيتحل جوّه
// معاملة القراءة والرفض الموحّد بييجي من هناك (CS-Q20). الإنشاء بـ @Require لأنه مقصور على قارئ النشاط كله،
// وفحصه بيتعاد جوّه معاملته بعد القفل. والصرف بـ @Require كذلك (CS-Q4)، وفحصه بيتعاد بعد قفل الشهر.
@Controller('businesses/:businessId/commission-statements')
export class CommissionStatementsController {
  constructor(
    @Inject(GET_COMMISSION_STATEMENT)
    private readonly getStatement: GetCommissionStatementUseCase | null,
    @Inject(GenerateCommissionStatementUseCase)
    private readonly generate: GenerateCommissionStatementUseCase | null,
    @Inject(MarkCommissionStatementPaidUseCase)
    private readonly markPaid: MarkCommissionStatementPaidUseCase | null,
  ) {}

  @Get(':period')
  @Header('Cache-Control', 'no-store')
  @Authenticated()
  async view(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('period', new ZodValidationPipe(commissionEstimatePeriod)) period: string,
    @Req() request: FastifyRequest,
  ): Promise<CommissionStatementView | CommissionStatementBranchView> {
    if (this.getStatement === null) throw new ApiError('NOT_READY');
    const actor = commissionEstimateActor(request);
    try {
      const view = await this.getStatement.execute({ ...actor, businessId, period });
      // الشركة بتتسجل في سياق السجل بعد إثبات العضوية جوّه المعاملة، فمش بنسجل هيدر غير مثبوت.
      bindVerifiedCompany(actor.companyId);
      return view.reader_scope === 'BUSINESS'
        ? commissionStatementView.parse(view)
        : commissionStatementBranchView.parse(view);
    } catch (error) {
      return mapCommissionWriteError(error);
    }
  }

  @Post(':period/generate')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Require('review:commissions:business', { business: 'businessId' })
  @RequiresFeature('commissions')
  async generateStatement(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('period', new ZodValidationPipe(commissionEstimatePeriod)) period: string,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ): Promise<CommissionStatementView> {
    if (this.generate === null) throw new ApiError('NOT_READY');
    try {
      return commissionStatementView.parse(
        await this.generate.execute({ ...actorOf(request), businessId, period, ...idem }),
      );
    } catch (error) {
      return mapCommissionWriteError(error);
    }
  }

  @Post(':period/mark-paid')
  @HttpCode(200)
  @Require('pay:commissions:business', { business: 'businessId' })
  @RequiresFeature('commissions')
  async markStatementPaid(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('period', new ZodValidationPipe(commissionStatementPeriod)) period: string,
    @Body(new ZodValidationPipe(markCommissionStatementPaidInput))
    input: MarkCommissionStatementPaidInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ): Promise<MarkCommissionStatementPaidResponse> {
    if (this.markPaid === null) throw new ApiError('NOT_READY');
    try {
      return markCommissionStatementPaidResponse.parse(
        await this.markPaid.execute({
          ...actorOf(request),
          businessId,
          period,
          input,
          ...idem,
        }),
      );
    } catch (error) {
      return mapCommissionWriteError(error);
    }
  }
}
