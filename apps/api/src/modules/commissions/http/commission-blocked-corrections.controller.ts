import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import {
  commissionBlockedCorrectionListQuery,
  id,
  type CommissionBlockedCorrectionList,
  type CommissionBlockedCorrectionListQuery,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  COMMISSION_BLOCKED_CORRECTION_LIST,
  CommissionBlockedCorrectionReadError,
  type CommissionBlockedCorrectionListRunner,
} from '../queries/commission-blocked-corrections.query.ts';

function mapReadError(error: unknown): never {
  if (error instanceof CommissionBlockedCorrectionReadError) {
    throw new ApiError(error.code);
  }
  throw error;
}

@Controller('businesses/:businessId/commission-blocked-corrections')
export class CommissionBlockedCorrectionsController {
  constructor(
    @Inject(COMMISSION_BLOCKED_CORRECTION_LIST)
    private readonly runner: CommissionBlockedCorrectionListRunner | null,
  ) {}

  // CS-Q48: القائمة لأصحاب صلاحية خطط العمولة، زي الجرس وإصلاح التصحيحات.
  @Get()
  @Require('manage:commission-plans:business', { business: 'businessId' })
  @RequiresFeature('commissions')
  async listBlockedCorrections(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Query(new ZodValidationPipe(commissionBlockedCorrectionListQuery))
    query: CommissionBlockedCorrectionListQuery,
    @Req() request: FastifyRequest,
  ): Promise<CommissionBlockedCorrectionList> {
    if (this.runner === null) throw new ApiError('NOT_READY');
    try {
      return await this.runner(actorOf(request), businessId, query);
    } catch (error) {
      return mapReadError(error);
    }
  }
}
