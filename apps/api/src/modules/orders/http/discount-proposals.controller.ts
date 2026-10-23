import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import {
  discountProposalRequestQuery,
  id,
  pendingDiscountProposalQuery,
  requestDiscountApprovalInput,
  type PendingDiscountProposalQuery,
  type RequestDiscountApprovalInput,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, requestFingerprint, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { PendingDiscountProposalsQuery } from '../queries/pending-discount-proposals.query.ts';
import { RequesterDiscountProposalsQuery } from '../queries/requester-discount-proposals.query.ts';
import { SessionDayReadError } from '../queries/branch-day-service-sessions.query.ts';
import { DiscountApprovalError, RequestDiscountApprovalUseCase } from '../use-cases/request-discount-approval/request-discount-approval.usecase.ts';
import { SessionAdminGuard } from './session-access.guard.ts';
import { SessionErrorsFilter } from './session-errors.filter.ts';

function fingerprint(request: FastifyRequest, body: unknown, businessId: string, branchId: string): string {
  const actor = actorOf(request);
  return requestFingerprint({ method: request.method, route: request.routeOptions.url ?? request.url, query: request.query, body,
    params: { businessId, branchId, companyId: actor.companyId, actorUserId: actor.userId } });
}

const pathId = id.toLowerCase();

@Controller('businesses/:businessId/branches/:branchId/discount-proposals')
@UseFilters(SessionErrorsFilter)
export class DiscountProposalsController {
  constructor(
    @Inject(RequestDiscountApprovalUseCase) private readonly requestApproval: RequestDiscountApprovalUseCase | null,
    @Inject(RequesterDiscountProposalsQuery) private readonly ownProposals: RequesterDiscountProposalsQuery | null,
    @Inject(PendingDiscountProposalsQuery) private readonly pendingProposals: PendingDiscountProposalsQuery | null,
  ) {}

  @Post()
  @HttpCode(201)
  @Require('record:service-sessions:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SessionAdminGuard)
  async create(
    @Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('branchId', new ZodValidationPipe(pathId)) branchId: string,
    @Body(new ZodValidationPipe(requestDiscountApprovalInput)) input: RequestDiscountApprovalInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.requestApproval === null) throw new ApiError('NOT_READY');
    try {
      return await this.requestApproval.execute({ ...actorOf(request), businessId, branchId, input,
        key: idem.key, fingerprint: fingerprint(request, input, businessId, branchId) });
    } catch (error) {
      if (error instanceof DiscountApprovalError) throw new ApiError(error.code, error.details);
      throw error;
    }
  }

  @Get()
  @Require('record:service-sessions:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SelectedCompanyGuard, SessionAdminGuard)
  async mine(
    @Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('branchId', new ZodValidationPipe(pathId)) branchId: string,
    @Query(new ZodValidationPipe(discountProposalRequestQuery)) query: { request_id: string },
    @Req() request: FastifyRequest,
  ) {
    if (this.ownProposals === null) throw new ApiError('NOT_READY');
    try {
      return await this.ownProposals.execute({ ...actorOf(request), businessId, branchId }, query);
    } catch (error) {
      if (error instanceof SessionDayReadError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Get('pending')
  @Require('approve:discounts:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SelectedCompanyGuard, SessionAdminGuard)
  async pending(
    @Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('branchId', new ZodValidationPipe(pathId)) branchId: string,
    @Query(new ZodValidationPipe(pendingDiscountProposalQuery)) query: PendingDiscountProposalQuery,
    @Req() request: FastifyRequest,
  ) {
    if (this.pendingProposals === null) throw new ApiError('NOT_READY');
    try {
      return await this.pendingProposals.execute({ ...actorOf(request), businessId, branchId }, query);
    } catch (error) {
      if (error instanceof SessionDayReadError) throw new ApiError(error.code);
      throw error;
    }
  }
}
