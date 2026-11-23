import { Body, Controller, HttpCode, Header, Inject, Param, Post, Req } from '@nestjs/common';
import {
  commissionClosedStatementView,
  commissionEstimatePeriod,
  commissionStatementApproveRequest,
  id,
  type CommissionClosedStatementView,
  type CommissionStatementApproveRequest,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { ApproveCommissionStatementUseCase } from '../use-cases/approve-statement/approve-statement.usecase.ts';
import { mapCommissionWriteError } from './commission-input-errors.ts';

// الاعتماد بـ @Require لأنه مقصور على صاحب `approve:commissions:business` وقارئ النشاط كله، وفحصه بيتعاد جوّه معاملته
// بعد قفل الشهور (ADR-0054 §7). مفتاح الاعتماد الصريح وبوابة التغطية بيتفحصوا جوّه المعاملة، فالدمج وحده ما بيفتحش شيء.
@Controller('businesses/:businessId/commission-statements')
export class CommissionStatementApproveController {
  constructor(
    @Inject(ApproveCommissionStatementUseCase)
    private readonly approve: ApproveCommissionStatementUseCase | null,
  ) {}

  @Post(':period/approve')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Require('approve:commissions:business', { business: 'businessId' })
  @RequiresFeature('commissions')
  async approveStatement(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('period', new ZodValidationPipe(commissionEstimatePeriod)) period: string,
    @Body(new ZodValidationPipe(commissionStatementApproveRequest))
    body: CommissionStatementApproveRequest,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ): Promise<CommissionClosedStatementView> {
    if (this.approve === null) throw new ApiError('NOT_READY');
    try {
      return commissionClosedStatementView.parse(
        await this.approve.execute({
          ...actorOf(request),
          businessId,
          period,
          expectedFingerprint: body.expected_fingerprint,
          expectedStatementFingerprint: body.expected_statement_fingerprint,
          ...idem,
        }),
      );
    } catch (error) {
      return mapCommissionWriteError(error);
    }
  }
}
