import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import {
  createCommissionPeriodRepairInput,
  id,
  type CommissionPeriodRepair,
  type CreateCommissionPeriodRepairInput,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { RepairCommissionPeriodUseCase } from '../use-cases/repair-commission-period/repair-commission-period.usecase.ts';
import { mapCommissionWriteError } from './commission-input-errors.ts';

@Controller('businesses/:businessId/employees/:employeeId/commission-period-repairs')
export class CommissionPeriodRepairsController {
  constructor(
    @Inject(RepairCommissionPeriodUseCase)
    private readonly repair: RepairCommissionPeriodUseCase | null,
  ) {}

  @Post()
  @HttpCode(201)
  @Require('manage:commission-plans:business', { business: 'businessId' })
  @RequiresFeature('commissions')
  async createRepair(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id.toLowerCase())) employeeId: string,
    @Body(new ZodValidationPipe(createCommissionPeriodRepairInput))
    input: CreateCommissionPeriodRepairInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ): Promise<CommissionPeriodRepair> {
    if (this.repair === null) throw new ApiError('NOT_READY');
    try {
      return await this.repair.execute({
        ...actorOf(request),
        businessId,
        employeeId,
        input,
        ...idem,
      });
    } catch (error) {
      return mapCommissionWriteError(error);
    }
  }
}
