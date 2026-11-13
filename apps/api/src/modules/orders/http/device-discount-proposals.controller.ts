import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res, UseFilters } from '@nestjs/common';
import {
  deviceApproveDiscountProposalsInput,
  deviceDiscountProposalQuery,
  deviceRejectDiscountProposalsInput,
  type DeviceApproveDiscountProposalsInput,
  type DeviceDiscountProposalQuery,
  type DeviceRejectDiscountProposalsInput,
} from '@pospay/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { SessionDayReadError } from '../queries/branch-day-service-sessions.query.ts';
import { DeviceDiscountProposalsQuery } from '../queries/device-discount-proposals.query.ts';
import { DecideDiscountByPinUseCase, DiscountPinError } from '../use-cases/decide-discount-by-pin/decide-discount-by-pin.usecase.ts';
import { DiscountDecisionError } from '../use-cases/decide-discount-proposals/decide-discount-proposals.usecase.ts';
import { SessionErrorsFilter } from './session-errors.filter.ts';

type DeviceDecisionInput = DeviceApproveDiscountProposalsInput | DeviceRejectDiscountProposalsInput;

function deviceOf(request: FastifyRequest) {
  const principal = request.principal;
  const branch = principal?.memberships[0];
  if (
    principal?.kind !== 'device' ||
    principal.deviceId === null ||
    branch?.scopeType !== 'BRANCH'
  ) {
    throw new ApiError('FORBIDDEN');
  }
  return { companyId: branch.companyId, deviceId: principal.deviceId, branchId: branch.scopeId };
}

@Controller('devices/me/discount-proposals')
@UseFilters(SessionErrorsFilter)
export class DeviceDiscountProposalsController {
  constructor(
    @Inject(DeviceDiscountProposalsQuery) private readonly proposals: DeviceDiscountProposalsQuery | null,
    @Inject(DecideDiscountByPinUseCase) private readonly decide: DecideDiscountByPinUseCase | null,
  ) {}

  @Get()
  @Authenticated()
  async list(
    @Query(new ZodValidationPipe(deviceDiscountProposalQuery)) query: DeviceDiscountProposalQuery,
    @Req() request: FastifyRequest,
  ) {
    const device = deviceOf(request);
    if (this.proposals === null) throw new ApiError('NOT_READY');
    try {
      return await this.proposals.execute(device, query);
    } catch (error) {
      if (error instanceof SessionDayReadError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Post('approve')
  @HttpCode(200)
  @Authenticated()
  async approve(
    @Body(new ZodValidationPipe(deviceApproveDiscountProposalsInput)) input: DeviceApproveDiscountProposalsInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header('Cache-Control', 'no-store');
    return this.decideByPin('APPROVE', input, request);
  }

  @Post('reject')
  @HttpCode(200)
  @Authenticated()
  async reject(
    @Body(new ZodValidationPipe(deviceRejectDiscountProposalsInput)) input: DeviceRejectDiscountProposalsInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header('Cache-Control', 'no-store');
    return this.decideByPin('REJECT', input, request);
  }

  private async decideByPin(
    decision: 'APPROVE' | 'REJECT',
    input: DeviceDecisionInput,
    request: FastifyRequest,
  ) {
    const device = deviceOf(request);
    if (this.decide === null) throw new ApiError('NOT_READY');
    try {
      return await this.decide.execute({ decision, input, device });
    } catch (error) {
      if (error instanceof DiscountPinError) throw new ApiError(error.code);
      if (error instanceof DiscountDecisionError) throw new ApiError(error.code, error.details);
      throw error;
    }
  }
}
