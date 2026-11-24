import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  commissionClosedStatementBranchView,
  commissionClosedStatementView,
  commissionEstimatePeriod,
  commissionStatementBranchView,
  commissionStatementReviewInput,
  commissionStatementReviewResult,
  commissionStatementReturnInput,
  commissionStatementReturnResult,
  commissionStatementView,
  id,
  type CommissionClosedStatementBranchView,
  type CommissionClosedStatementView,
  type CommissionStatementBranchView,
  type CommissionStatementReviewInput,
  type CommissionStatementReviewResult,
  type CommissionStatementReturnInput,
  type CommissionStatementReturnResult,
  type CommissionStatementView,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import {
  Authenticated,
  Require,
  RequireAny,
  RequiresFeature,
} from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { bindVerifiedCompany } from '../../../shared/request-context.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { GenerateCommissionStatementUseCase } from '../use-cases/generate-statement/generate-statement.usecase.ts';
import type { GetCommissionStatementUseCase } from '../use-cases/get-statement/get-statement.usecase.ts';
import { ReviewCommissionStatementUseCase } from '../use-cases/review-statement/review-statement.usecase.ts';
import { ReturnCommissionStatementUseCase } from '../use-cases/return-statement/return-statement.usecase.ts';
import { commissionEstimateActor } from './commission-estimate.controller.ts';
import { mapCommissionWriteError } from './commission-input-errors.ts';

export const GET_COMMISSION_STATEMENT = Symbol('GET_COMMISSION_STATEMENT');

// القراءة بـ @Authenticated زي التقدير: صلاحية القارئ ممكن تكون على مستوى الفرع، فالنطاق بيتحل جوّه
// معاملة القراءة والرفض الموحّد بييجي من هناك (CS-Q20). الإنشاء بـ @Require لأنه مقصور على قارئ النشاط كله،
// وفحصه بيتعاد جوّه معاملته بعد القفل. الإرجاع بـ @RequireAny لأن صاحبه مراجع **أو** معتمد (FR-031).
@Controller('businesses/:businessId/commission-statements')
export class CommissionStatementsController {
  constructor(
    @Inject(GET_COMMISSION_STATEMENT)
    private readonly getStatement: GetCommissionStatementUseCase | null,
    @Inject(GenerateCommissionStatementUseCase)
    private readonly generate: GenerateCommissionStatementUseCase | null,
    @Inject(ReviewCommissionStatementUseCase)
    private readonly review: ReviewCommissionStatementUseCase | null,
    @Inject(ReturnCommissionStatementUseCase)
    private readonly returnStatement: ReturnCommissionStatementUseCase | null,
  ) {}

  @Get(':period')
  @Header('Cache-Control', 'no-store')
  @Authenticated()
  async view(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('period', new ZodValidationPipe(commissionEstimatePeriod)) period: string,
    @Req() request: FastifyRequest,
  ): Promise<
    | CommissionStatementView
    | CommissionStatementBranchView
    | CommissionClosedStatementView
    | CommissionClosedStatementBranchView
  > {
    if (this.getStatement === null) throw new ApiError('NOT_READY');
    const actor = commissionEstimateActor(request);
    try {
      const view = await this.getStatement.execute({ ...actor, businessId, period });
      // الشركة بتتسجل في سياق السجل بعد إثبات العضوية جوّه المعاملة، فمش بنسجل هيدر غير مثبوت.
      bindVerifiedCompany(actor.companyId);
      const closed = view.status === 'APPROVED' || view.status === 'PAID';
      if (view.reader_scope === 'BUSINESS') {
        return closed ? commissionClosedStatementView.parse(view) : commissionStatementView.parse(view);
      }
      return closed
        ? commissionClosedStatementBranchView.parse(view)
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

  @Post(':period/review')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Require('review:commissions:business', { business: 'businessId' })
  @RequiresFeature('commissions')
  async reviewStatement(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('period', new ZodValidationPipe(commissionEstimatePeriod)) period: string,
    @Body(new ZodValidationPipe(commissionStatementReviewInput))
    input: CommissionStatementReviewInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ): Promise<CommissionStatementReviewResult> {
    if (this.review === null) throw new ApiError('NOT_READY');
    try {
      return commissionStatementReviewResult.parse(
        await this.review.execute({
          ...actorOf(request),
          businessId,
          period,
          expectedFingerprint: input.expected_fingerprint,
          expectedStatementFingerprint: input.expected_statement_fingerprint,
          ...idem,
        }),
      );
    } catch (error) {
      return mapCommissionWriteError(error);
    }
  }

  @Post(':period/return')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequireAny(['review:commissions:business', 'approve:commissions:business'], {
    business: 'businessId',
  })
  @RequiresFeature('commissions')
  async returnReviewedStatement(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('period', new ZodValidationPipe(commissionEstimatePeriod)) period: string,
    @Body(new ZodValidationPipe(commissionStatementReturnInput))
    input: CommissionStatementReturnInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ): Promise<CommissionStatementReturnResult> {
    if (this.returnStatement === null) throw new ApiError('NOT_READY');
    try {
      return commissionStatementReturnResult.parse(
        await this.returnStatement.execute({
          ...actorOf(request),
          businessId,
          period,
          reason: input.reason,
          ...idem,
        }),
      );
    } catch (error) {
      return mapCommissionWriteError(error);
    }
  }
}
