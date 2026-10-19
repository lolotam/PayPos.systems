import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { appendServiceSessionLinesInput, cancelServiceLineInput, editServiceLineInput, id, recordServiceSessionInput, serviceLineEditsQuery, serviceSessionDayQuery, type AppendServiceSessionLinesInput, type CancelServiceLineInput, type EditServiceLineInput, type RecordServiceSessionInput, type ServiceLineEditsQuery, type ServiceSessionDayQuery } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Authenticated, Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, requestFingerprint, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { RecordServiceSessionUseCase } from '../use-cases/record-service-session/record-service-session.usecase.ts';
import { AppendServiceSessionLinesUseCase } from '../use-cases/append-service-session-lines/append-service-session-lines.usecase.ts';
import { CancelServiceLineUseCase } from '../use-cases/cancel-service-line/cancel-service-line.usecase.ts';
import { EditServiceLinePriceUseCase } from '../use-cases/edit-service-line-price/edit-service-line-price.usecase.ts';
import { SessionAdminGuard, SessionAppendGuard } from './session-access.guard.ts';
import { SessionErrorsFilter } from './session-errors.filter.ts';
import { BranchDayServiceSessionsQuery, SessionDayReadError } from '../queries/branch-day-service-sessions.query.ts';
import { ServiceLineCancellationQuery } from '../queries/service-line-cancellation.query.ts';
import { ServiceSessionCapabilitiesQuery } from '../queries/service-session-capabilities.query.ts';
import { ServiceLineEditHistoryQuery } from '../queries/service-line-edits.query.ts';

function fingerprint(request: FastifyRequest, body: unknown, businessId: string, branchId: string, sessionId?: string, lineId?: string): string {
  const actor = actorOf(request);
  return requestFingerprint({ method: request.method, route: request.routeOptions.url ?? request.url, query: request.query, body,
    params: { businessId, branchId, companyId: actor.companyId, actorUserId: actor.userId,
      ...(sessionId === undefined ? {} : { sessionId }), ...(lineId === undefined ? {} : { lineId }) } });
}
const pathId = id.toLowerCase();

@Controller('businesses/:businessId/branches/:branchId/service-sessions')
@UseFilters(SessionErrorsFilter)
export class ServiceSessionsController {
  constructor(@Inject(RecordServiceSessionUseCase) private readonly record: RecordServiceSessionUseCase | null,
    @Inject(AppendServiceSessionLinesUseCase) private readonly appendLines: AppendServiceSessionLinesUseCase | null,
    @Inject(EditServiceLinePriceUseCase) private readonly editLine: EditServiceLinePriceUseCase | null,
    @Inject(CancelServiceLineUseCase) private readonly cancelLine: CancelServiceLineUseCase | null,
    @Inject(BranchDayServiceSessionsQuery) private readonly dayList: BranchDayServiceSessionsQuery | null,
    @Inject(ServiceLineEditHistoryQuery) private readonly history: ServiceLineEditHistoryQuery | null,
    @Inject(ServiceLineCancellationQuery) private readonly cancellationRead: ServiceLineCancellationQuery | null,
    @Inject(ServiceSessionCapabilitiesQuery) private readonly capabilitiesRead: ServiceSessionCapabilitiesQuery | null) {}
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
  @Get('capabilities')
  @Require('read:service-sessions:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SelectedCompanyGuard, SessionAdminGuard)
  async capabilities(@Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('branchId', new ZodValidationPipe(pathId)) branchId: string,
    @Req() request: FastifyRequest) {
    if (this.capabilitiesRead === null) throw new ApiError('NOT_READY');
    try { return await this.capabilitiesRead.execute({ ...actorOf(request), businessId, branchId }); }
    catch (error) {
      if (error instanceof SessionDayReadError) throw new ApiError(error.code);
      throw error;
    }
  }
  @Get(':sessionId/lines/:lineId/edits')
  @Require('read:service-sessions:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SelectedCompanyGuard, SessionAdminGuard)
  async edits(@Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('branchId', new ZodValidationPipe(pathId)) branchId: string,
    @Param('sessionId', new ZodValidationPipe(pathId)) sessionId: string,
    @Param('lineId', new ZodValidationPipe(pathId)) lineId: string,
    @Query(new ZodValidationPipe(serviceLineEditsQuery)) query: ServiceLineEditsQuery,
    @Req() request: FastifyRequest) {
    if (this.history === null) throw new ApiError('NOT_READY');
    try { return await this.history.execute({ ...actorOf(request), businessId, branchId, sessionId, lineId }, query); }
    catch (error) {
      if (error instanceof SessionDayReadError) throw new ApiError(error.code);
      throw error;
    }
  }
  @Get(':sessionId/lines/:lineId/cancellation')
  @Require('read:service-sessions:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SelectedCompanyGuard, SessionAdminGuard)
  async cancellation(@Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('branchId', new ZodValidationPipe(pathId)) branchId: string,
    @Param('sessionId', new ZodValidationPipe(pathId)) sessionId: string,
    @Param('lineId', new ZodValidationPipe(pathId)) lineId: string,
    @Req() request: FastifyRequest) {
    if (this.cancellationRead === null) throw new ApiError('NOT_READY');
    try { return await this.cancellationRead.execute({ ...actorOf(request), businessId, branchId, sessionId, lineId }); }
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
  @Patch(':sessionId/lines/:lineId')
  @HttpCode(200)
  @Require('edit:service-line-prices:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SessionAdminGuard)
  async edit(@Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('branchId', new ZodValidationPipe(pathId)) branchId: string,
    @Param('sessionId', new ZodValidationPipe(pathId)) sessionId: string,
    @Param('lineId', new ZodValidationPipe(pathId)) lineId: string,
    @Body(new ZodValidationPipe(editServiceLineInput)) input: EditServiceLineInput,
    @Idempotency() idem: IdempotencyInput, @Req() request: FastifyRequest) {
    if (this.editLine === null) throw new ApiError('NOT_READY');
    return this.editLine.execute({ ...actorOf(request), businessId, branchId, sessionId, lineId, input, key: idem.key,
      fingerprint: fingerprint(request, input, businessId, branchId, sessionId, lineId) });
  }
  @Post(':sessionId/lines/:lineId/cancellation')
  @HttpCode(200)
  @Require('cancel:service-lines:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SessionAdminGuard)
  async cancel(@Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('branchId', new ZodValidationPipe(pathId)) branchId: string,
    @Param('sessionId', new ZodValidationPipe(pathId)) sessionId: string,
    @Param('lineId', new ZodValidationPipe(pathId)) lineId: string,
    @Body(new ZodValidationPipe(cancelServiceLineInput)) input: CancelServiceLineInput,
    @Idempotency() idem: IdempotencyInput, @Req() request: FastifyRequest) {
    if (this.cancelLine === null) throw new ApiError('NOT_READY');
    return this.cancelLine.execute({ ...actorOf(request), businessId, branchId, sessionId, lineId, input, key: idem.key,
      fingerprint: fingerprint(request, input, businessId, branchId, sessionId, lineId) });
  }
}
