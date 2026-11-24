import { Body, Controller, Header, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import {
  commissionStatementPeriod,
  id,
  markCommissionStatementPaidInput,
  type MarkCommissionStatementPaidInput,
  type MarkCommissionStatementPaidResponse,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { MarkCommissionStatementPaidUseCase } from '../use-cases/mark-statement-paid/mark-statement-paid.usecase.ts';
import { mapCommissionWriteError } from './commission-input-errors.ts';

// الصرف بـ @Require لأنه مقصور على صاحب `pay:commissions:business` على النشاط كله (CS-Q4)، وفحصه بيتعاد جوّه معاملته
// بعد قفل الشهر. الرد بيتحقق من شكله جوّه المعاملة نفسها قبل الـ commit، فالمتحكم هنا بيرجّعه زي ما هو.
@Controller('businesses/:businessId/commission-statements')
export class CommissionStatementPayController {
  constructor(
    @Inject(MarkCommissionStatementPaidUseCase)
    private readonly markPaid: MarkCommissionStatementPaidUseCase | null,
  ) {}

  @Post(':period/mark-paid')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
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
      return await this.markPaid.execute({
        ...actorOf(request),
        businessId,
        period,
        input,
        ...idem,
      });
    } catch (error) {
      return mapCommissionWriteError(error);
    }
  }
}
