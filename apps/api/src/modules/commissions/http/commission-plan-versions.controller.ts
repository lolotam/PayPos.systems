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
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  CommissionPlanVersionEmployeeNotFoundError,
  listCommissionPlanVersions,
} from '../queries/commission-plan-versions.query.ts';
import { CreateCommissionPlanVersionUseCase } from '../use-cases/create-commission-plan-version/create-commission-plan-version.usecase.ts';
import { mapCommissionWriteError } from './commission-input-errors.ts';

const pathId = id.toLowerCase();

function mapReadError(error: unknown): never {
  if (error instanceof CommissionPlanVersionEmployeeNotFoundError) {
    throw new ApiError('EMPLOYEE_NOT_FOUND');
  }
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
      return mapCommissionWriteError(error);
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
    try {
      return await this.database.withTenant(
        actor.companyId,
        (tx) => listCommissionPlanVersions(tx, actor.companyId, businessId, employeeId, query),
        { userId: actor.userId },
      );
    } catch (error) {
      return mapReadError(error);
    }
  }
}
