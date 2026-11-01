import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  commissionServiceOverrideListQuery,
  createCommissionServiceOverrideInput,
  id,
  type CommissionServiceOverride,
  type CommissionServiceOverrideList,
  type CommissionServiceOverrideListQuery,
  type CreateCommissionServiceOverrideInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  COMMISSION_SERVICE_OVERRIDE_LIST_READS,
  CommissionServiceOverrideReadError,
  listCommissionServiceOverrides,
  type CommissionServiceOverrideListReadsFactory,
} from '../queries/commission-service-overrides.query.ts';
import { CreateCommissionServiceOverrideUseCase } from '../use-cases/create-commission-service-override/create-commission-service-override.usecase.ts';
import { mapCommissionWriteError } from './commission-input-errors.ts';

const pathId = id.toLowerCase();

function mapReadError(error: unknown): never {
  if (error instanceof CommissionServiceOverrideReadError) {
    throw new ApiError(error.code);
  }
  throw error;
}

@Controller('businesses/:businessId/employees/:employeeId/commission-overrides')
export class CommissionServiceOverridesController {
  constructor(
    @Inject(CreateCommissionServiceOverrideUseCase)
    private readonly create: CreateCommissionServiceOverrideUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(COMMISSION_SERVICE_OVERRIDE_LIST_READS)
    private readonly listReads: CommissionServiceOverrideListReadsFactory,
  ) {}

  @Post()
  @HttpCode(201)
  @Require('manage:commission-plans:business', { business: 'businessId' })
  @RequiresFeature('commissions')
  async createOverride(
    @Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(pathId)) employeeId: string,
    @Body(new ZodValidationPipe(createCommissionServiceOverrideInput))
    input: CreateCommissionServiceOverrideInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ): Promise<CommissionServiceOverride> {
    if (this.create === null) throw new ApiError('NOT_READY');
    try {
      return await this.create.execute({
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

  @Get()
  @Require('manage:commission-plans:business', { business: 'businessId' })
  @RequiresFeature('commissions')
  async listOverrides(
    @Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(pathId)) employeeId: string,
    @Query(new ZodValidationPipe(commissionServiceOverrideListQuery))
    query: CommissionServiceOverrideListQuery,
    @Req() request: FastifyRequest,
  ): Promise<CommissionServiceOverrideList> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    try {
      return await this.database.withTenant(
        actor.companyId,
        (tx) =>
          listCommissionServiceOverrides(
            tx,
            this.listReads(tx),
            {
              companyId: actor.companyId,
              userId: actor.userId,
              businessId,
              employeeId,
              serviceId: query.service_id,
            },
            query,
          ),
        { userId: actor.userId },
      );
    } catch (error) {
      return mapReadError(error);
    }
  }
}
