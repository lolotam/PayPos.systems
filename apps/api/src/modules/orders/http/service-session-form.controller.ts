import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { id, recordingContextQuery, type RecordingContextQuery } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { RecordingContextQueryHandler, RecordingContextReadError } from '../queries/recording-context.query.ts';
import { SessionAdminGuard } from './session-access.guard.ts';

@Controller('businesses/:businessId/branches/:branchId/service-sessions')
export class ServiceSessionFormController {
  constructor(@Inject(RecordingContextQueryHandler) private readonly context: RecordingContextQueryHandler | null) {}
  @Get('recording-context')
  @Require('record:service-sessions:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SelectedCompanyGuard, SessionAdminGuard)
  async read(@Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('branchId', new ZodValidationPipe(id.toLowerCase())) branchId: string,
    @Query(new ZodValidationPipe(recordingContextQuery)) query: RecordingContextQuery,
    @Req() request: FastifyRequest) {
    if (this.context === null) throw new ApiError('NOT_READY');
    try { return await this.context.execute({ ...actorOf(request), businessId, branchId }, query); }
    catch (error) {
      if (error instanceof RecordingContextReadError) throw new ApiError(error.code);
      throw error;
    }
  }
}
