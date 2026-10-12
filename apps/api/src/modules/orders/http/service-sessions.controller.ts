import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { appendServiceSessionLinesInput, recordServiceSessionInput, id, type AppendServiceSessionLinesInput, type RecordServiceSessionInput } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Authenticated, Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, requestFingerprint, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { RecordServiceSessionUseCase } from '../use-cases/record-service-session/record-service-session.usecase.ts';
import { AppendServiceSessionLinesUseCase } from '../use-cases/append-service-session-lines/append-service-session-lines.usecase.ts';
import { SessionAdminGuard, SessionAppendGuard } from './session-access.guard.ts';
import { SessionErrorsFilter } from './session-errors.filter.ts';
import { serviceSessionDayQuery, type ServiceSessionDayQuery } from '@pospay/contracts';
import { BranchDayServiceSessionsQuery, SessionDayReadError } from '../queries/branch-day-service-sessions.query.ts';

function fingerprint(request: FastifyRequest, body: unknown, businessId: string, branchId: string, sessionId?: string): string {
  const actor = actorOf(request);
  return requestFingerprint({ method: request.method, route: request.routeOptions.url ?? request.url, query: request.query, body,
    params: { businessId, branchId, companyId: actor.companyId, actorUserId: actor.userId, ...(sessionId === undefined ? {} : { sessionId }) } });
}
const pathId = id.toLowerCase();

@Controller('businesses/:businessId/branches/:branchId/service-sessions')
@UseFilters(SessionErrorsFilter)
export class ServiceSessionsController {
  constructor(@Inject(RecordServiceSessionUseCase) private readonly record: RecordServiceSessionUseCase | null,
    @Inject(AppendServiceSessionLinesUseCase) private readonly appendLines: AppendServiceSessionLinesUseCase | null,
    @Inject(BranchDayServiceSessionsQuery) private readonly dayList: BranchDayServiceSessionsQuery | null) {}
  @Get()
  @Require('read:service-sessions:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SelectedCompanyGuard, SessionAdminGuard)
  async list(@Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('branchId', new ZodValidationPipe(pathId)) branchId: string,
    @Query(new ZodValidationPipe(serviceSessionDayQuery)) query: ServiceSessionDayQuery,
    @Req() request: FastifyRequest) {
    if (this.dayList === null) throw new ApiError('NOT_READY');
    try { return await this.dayList.execute({ ...actorOf(request), businessId, branchId }, query); }
    catch (error) {
      if (error instanceof SessionDayReadError) throw new ApiError(error.code);
      throw error;
    }
  }
  @Post()
  @HttpCode(201)
  @Require('record:service-sessions:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SessionAdminGuard)
  async create(@Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('branchId', new ZodValidationPipe(pathId)) branchId: string,
    @Body(new ZodValidationPipe(recordServiceSessionInput)) input: RecordServiceSessionInput,
    @Idempotency() idem: IdempotencyInput, @Req() request: FastifyRequest) {
    if (this.record === null) throw new ApiError('NOT_READY');
    return this.record.execute({ ...actorOf(request), businessId, branchId, input, key: idem.key, fingerprint: fingerprint(request, input, businessId, branchId) });
  }
  @Post(':sessionId/lines')
  @HttpCode(201)
  @Authenticated()
  @UseGuards(SelectedCompanyGuard, SessionAppendGuard)
  async append(@Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('branchId', new ZodValidationPipe(pathId)) branchId: string,
    @Param('sessionId', new ZodValidationPipe(pathId)) sessionId: string,
    @Body(new ZodValidationPipe(appendServiceSessionLinesInput)) input: AppendServiceSessionLinesInput,
    @Idempotency() idem: IdempotencyInput, @Req() request: FastifyRequest) {
    if (this.appendLines === null) throw new ApiError('NOT_READY');
    return this.appendLines.execute({ ...actorOf(request), businessId, branchId, sessionId, input, key: idem.key, fingerprint: fingerprint(request, input, businessId, branchId, sessionId) });
  }
}
