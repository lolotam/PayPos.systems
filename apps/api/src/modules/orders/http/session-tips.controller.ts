import { Body, Controller, Get, HttpCode, Inject, Param, Put, Req, UseFilters, UseGuards } from '@nestjs/common';
import { id, recordSessionTipsInput, type RecordSessionTipsInput } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, requestFingerprint, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { SessionTipsCurrentQuery, SessionTipsReadError } from '../queries/session-tips-current.query.ts';
import { SessionError } from '../use-cases/record-service-session/record-service-session.usecase.ts';
import { RecordSessionTipsUseCase } from '../use-cases/record-session-tips/record-session-tips.usecase.ts';
import { SessionAdminGuard } from './session-access.guard.ts';
import { SessionErrorsFilter } from './session-errors.filter.ts';

function fingerprint(request: FastifyRequest, body: unknown, businessId: string, branchId: string, sessionId: string): string {
  const actor = actorOf(request);
  return requestFingerprint({
    method: request.method, route: request.routeOptions.url ?? request.url, query: request.query, body,
    params: { businessId, branchId, companyId: actor.companyId, actorUserId: actor.userId, sessionId },
  });
}

const pathId = id.toLowerCase();

@Controller('businesses/:businessId/branches/:branchId/service-sessions')
@UseFilters(SessionErrorsFilter)
export class SessionTipsController {
  constructor(@Inject(RecordSessionTipsUseCase) private readonly record: RecordSessionTipsUseCase | null,
    @Inject(SessionTipsCurrentQuery) private readonly current: SessionTipsCurrentQuery | null) {}

  @Put(':sessionId/tips')
  @HttpCode(200)
  @Require('record:service-sessions:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SessionAdminGuard)
  async replace(@Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('branchId', new ZodValidationPipe(pathId)) branchId: string,
    @Param('sessionId', new ZodValidationPipe(pathId)) sessionId: string,
    @Body(new ZodValidationPipe(recordSessionTipsInput)) input: RecordSessionTipsInput,
    @Idempotency() idem: IdempotencyInput, @Req() request: FastifyRequest) {
    if (this.record === null) throw new ApiError('NOT_READY');
    return this.record.execute({
      ...actorOf(request), businessId, branchId, sessionId, input, key: idem.key,
      fingerprint: fingerprint(request, input, businessId, branchId, sessionId),
    });
  }

  @Get(':sessionId/tips')
  @Require('record:service-sessions:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SelectedCompanyGuard, SessionAdminGuard)
  async read(@Param('businessId', new ZodValidationPipe(pathId)) businessId: string,
    @Param('branchId', new ZodValidationPipe(pathId)) branchId: string,
    @Param('sessionId', new ZodValidationPipe(pathId)) sessionId: string,
    @Req() request: FastifyRequest) {
    if (this.current === null) throw new ApiError('NOT_READY');
    try {
      return await this.current.execute({ ...actorOf(request), businessId, branchId, sessionId });
    } catch (error) {
      // القراءة ترفض زي الكتابة: زيارة مجهولة أو خارج الفرع جسم واحد، بلا تمييز.
      if (error instanceof SessionTipsReadError && error.code === 'FEATURE_DISABLED') throw new ApiError('FEATURE_DISABLED');
      if (error instanceof SessionTipsReadError) throw new SessionError('SESSION_NOT_FOUND');
      throw error;
    }
  }
}
