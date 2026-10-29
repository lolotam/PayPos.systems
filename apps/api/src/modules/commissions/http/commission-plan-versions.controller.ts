import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  createCommissionPlanVersionInput,
  id,
  commissionPlanVersionListQuery,
  type CommissionPlanVersion,
  type CommissionPlanVersionList,
  type CommissionPlanVersionListQuery,
  type CreateCommissionPlanVersionInput,
} from '@pospay/contracts';
import {
  IdempotencyKeyBusyError,
  IdempotencyKeyReusedError,
  StatementPeriodClosedError,
  type TenantWrappers,
} from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { listCommissionPlanVersions } from '../queries/commission-plan-versions.query.ts';
import {
  CommissionPlanVersionError,
  CreateCommissionPlanVersionUseCase,
} from '../use-cases/create-commission-plan-version/create-commission-plan-version.usecase.ts';

const pathId = id.toLowerCase();

function mapWriteError(error: unknown): never {
  if (error instanceof CommissionPlanVersionError) {
    throw new ApiError(error.code, error.details);
  }
  if (error instanceof StatementPeriodClosedError) {
    throw new ApiError('COMMISSION_PERIOD_CLOSED');
  }
  if (error instanceof IdempotencyKeyReusedError) throw new ApiError('IDEMPOTENCY_KEY_REUSED');
  if (error instanceof IdempotencyKeyBusyError) throw new ApiError('IDEMPOTENCY_KEY_IN_PROGRESS');
  throw error;
}

@Controller('businesses/:businessId/employees/:employeeId/commission-plan-versions')
export class CommissionPlanVersionsController {
  constructor(
    @Inject(CreateCommissionPlanVersionUseCase)
    private readonly create: CreateCommissionPlanVersionUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
  ) {}

  @Post()
  @HttpCode(201)
  @Require('manage:commission-plans:business', { business: 'businessId' })
  @RequiresFeature('commissions')
  async createVersion(
    @Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(pathId)) employeeId: string,
    @Body(new ZodValidationPipe(createCommissionPlanVersionInput))
    input: CreateCommissionPlanVersionInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ): Promise<CommissionPlanVersion> {
    if (this.create === null) throw new ApiError('NOT_READY');
    try {
      return await this.create.execute({ ...actorOf(request), businessId, employeeId, input, ...idem });
    } catch (error) {
      return mapWriteError(error);
    }
  }

  @Get()
  @Require('manage:commission-plans:business', { business: 'businessId' })
  @RequiresFeature('commissions')
  async listVersions(
    @Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(pathId)) employeeId: string,
    @Query(new ZodValidationPipe(commissionPlanVersionListQuery))
    query: CommissionPlanVersionListQuery,
    @Req() request: FastifyRequest,
  ): Promise<CommissionPlanVersionList> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    return this.database.withTenant(
      actor.companyId,
      (tx) => listCommissionPlanVersions(tx, actor.companyId, businessId, employeeId, query),
      { userId: actor.userId },
    );
  }
}
