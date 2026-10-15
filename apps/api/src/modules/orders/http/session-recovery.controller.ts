import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { confirmSessionRecoveryBody, id, serviceSessionRecoveryQuery, type ConfirmSessionRecoveryBody, type ServiceSessionRecoveryQuery } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { SessionRecoveryQuery, SessionRecoveryReadError } from '../queries/session-recovery.query.ts';
import { SessionError } from '../use-cases/record-service-session/record-service-session.usecase.ts';
import { ConfirmSessionRecoveryUseCase } from '../use-cases/confirm-session-recovery/confirm-session-recovery.usecase.ts';
import { SessionAdminGuard } from './session-access.guard.ts';
import { SessionErrorsFilter } from './session-errors.filter.ts';

const pathId = id.toLowerCase();
const RECOVERY_KEY = /^[!-~]{1,255}$/;

function recoveryKey(request: FastifyRequest): string {
  const header = request.headers['x-recovery-key'];
  if (typeof header !== 'string' || !RECOVERY_KEY.test(header)) throw new ApiError('VALIDATION_FAILED');
  return header;
}

function readFailure(error: SessionRecoveryReadError): ApiError | SessionError {
  if (error.code === 'SESSION_RECOVERY_NOT_FOUND' || error.code === 'SESSION_RECOVERY_NOT_YET' || error.code === 'SESSION_RECOVERY_CLOSED') {
    return new SessionError(error.code, error.details);
  }
  return new ApiError(error.code, error.details);
}

@Controller('businesses/:businessId/branches/:branchId/service-sessions/recovery')
@UseFilters(SessionErrorsFilter)
export class SessionRecoveryController {
  constructor(@Inject(SessionRecoveryQuery) private readonly query: SessionRecoveryQuery | null,
    @Inject(ConfirmSessionRecoveryUseCase) private readonly confirmRecovery: ConfirmSessionRecoveryUseCase | null) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @Require('record:service-sessions:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SelectedCompanyGuard, SessionAdminGuard)
  async read(@Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('branchId', new ZodValidationPipe(pathId)) branchId: string,
    @Query(new ZodValidationPipe(serviceSessionRecoveryQuery)) query: ServiceSessionRecoveryQuery,
    @Req() request: FastifyRequest) {
    if (this.query === null) throw new ApiError('NOT_READY');
    try { return await this.query.execute({ ...actorOf(request), businessId, branchId }, query.operation, recoveryKey(request), query.cursor); }
    catch (error) {
      if (error instanceof SessionRecoveryReadError) throw readFailure(error);
      throw error;
    }
  }
  @Post('confirm')
  @HttpCode(204)
  @Require('record:service-sessions:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SelectedCompanyGuard, SessionAdminGuard)
  async confirm(@Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('branchId', new ZodValidationPipe(pathId)) branchId: string,
    @Body(new ZodValidationPipe(confirmSessionRecoveryBody)) body: ConfirmSessionRecoveryBody,
    @Req() request: FastifyRequest): Promise<void> {
    if (this.confirmRecovery === null) throw new ApiError('NOT_READY');
    await this.confirmRecovery.execute({ ...actorOf(request), businessId, branchId, operation: body.operation, outcome: body.outcome, key: recoveryKey(request) });
  }
}
