import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import {
  approveDiscountProposalsInput,
  discountProposalRequestQuery,
  id,
  pendingDiscountProposalQuery,
  rejectDiscountProposalsInput,
  requestDiscountApprovalInput,
  type ApproveDiscountProposalsInput,
  type PendingDiscountProposalQuery,
  type RejectDiscountProposalsInput,
  type RequestDiscountApprovalInput,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, requestFingerprint, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { PendingDiscountProposalsQuery } from '../queries/pending-discount-proposals.query.ts';
import { RequesterDiscountProposalsQuery } from '../queries/requester-discount-proposals.query.ts';
import { SessionDayReadError } from '../queries/branch-day-service-sessions.query.ts';
import { DiscountApprovalError, RequestDiscountApprovalUseCase } from '../use-cases/request-discount-approval/request-discount-approval.usecase.ts';
import { DecideDiscountProposalsUseCase, DiscountDecisionError } from '../use-cases/decide-discount-proposals/decide-discount-proposals.usecase.ts';
import { SessionAdminGuard } from './session-access.guard.ts';
import { SessionErrorsFilter } from './session-errors.filter.ts';

function fingerprint(request: FastifyRequest, body: unknown, businessId: string, branchId: string): string {
  const actor = actorOf(request);
  return requestFingerprint({ method: request.method, route: request.routeOptions.url ?? request.url, query: request.query, body,
    params: { businessId, branchId, companyId: actor.companyId, actorUserId: actor.userId } });
}

const pathId = id.toLowerCase();
type DecisionInput = ApproveDiscountProposalsInput | RejectDiscountProposalsInput;

@Controller('businesses/:businessId/branches/:branchId/discount-proposals')
@UseFilters(SessionErrorsFilter)
export class DiscountProposalsController {
  constructor(
    @Inject(RequestDiscountApprovalUseCase) private readonly requestApproval: RequestDiscountApprovalUseCase | null,
    @Inject(RequesterDiscountProposalsQuery) private readonly ownProposals: RequesterDiscountProposalsQuery | null,
    @Inject(PendingDiscountProposalsQuery) private readonly pendingProposals: PendingDiscountProposalsQuery | null,
    @Inject(DecideDiscountProposalsUseCase) private readonly decideProposals: DecideDiscountProposalsUseCase | null,
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
  @UseGuards(SessionAdminGuard)
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
  @UseGuards(SessionAdminGuard)
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

  @Post('approve')
  @HttpCode(200)
  @Require('approve:discounts:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SessionAdminGuard)
  async approve(
    @Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('branchId', new ZodValidationPipe(pathId)) branchId: string,
    @Body(new ZodValidationPipe(approveDiscountProposalsInput)) input: ApproveDiscountProposalsInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ) {
    return this.decide('APPROVE', businessId, branchId, input, idem, request);
  }

  @Post('reject')
  @HttpCode(200)
  @Require('approve:discounts:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SessionAdminGuard)
  async reject(
    @Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('branchId', new ZodValidationPipe(pathId)) branchId: string,
    @Body(new ZodValidationPipe(rejectDiscountProposalsInput)) input: RejectDiscountProposalsInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ) {
    return this.decide('REJECT', businessId, branchId, input, idem, request);
  }

  private async decide(
    decision: 'APPROVE' | 'REJECT',
    businessId: string,
    branchId: string,
    input: DecisionInput,
    idem: IdempotencyInput,
    request: FastifyRequest,
  ) {
    if (this.decideProposals === null) throw new ApiError('NOT_READY');
    try {
      return await this.decideProposals.execute({ ...actorOf(request), businessId, branchId, decision, input,
        key: idem.key, fingerprint: fingerprint(request, input, businessId, branchId) });
    } catch (error) {
      if (error instanceof DiscountDecisionError) throw new ApiError(error.code, error.details);
      throw error;
    }
  }
}
