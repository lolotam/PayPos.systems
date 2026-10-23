import { Controller, Get, Inject, Param, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import { id, recordingContextQuery, sessionServiceOptionsQuery, sessionPerformerOptionsQuery, type RecordingContextQuery,
  type SessionServiceOptionsQuery, type SessionPerformerOptionsQuery } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { updateRequestContext } from '@pospay/observability';
import { Authenticated, Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { RecordingContextQueryHandler, RecordingContextReadError } from '../queries/recording-context.query.ts';
import { SessionAdminGuard } from './session-access.guard.ts';
import { SessionServiceOptionsQueryHandler } from '../queries/session-service-options.query.ts';
import { SessionPerformerOptionsQueryHandler } from '../queries/session-performer-options.query.ts';
import { SessionErrorsFilter } from './session-errors.filter.ts';

@Controller('businesses/:businessId/branches/:branchId/service-sessions')
export class ServiceSessionFormController {
  constructor(@Inject(RecordingContextQueryHandler) private readonly context: RecordingContextQueryHandler | null,
    @Inject(SessionServiceOptionsQueryHandler) private readonly options: SessionServiceOptionsQueryHandler | null,
    @Inject(SessionPerformerOptionsQueryHandler) private readonly performerOptions: SessionPerformerOptionsQueryHandler | null) {}
  // قايمة المحرر تقبل التسجيل أو تغيير المنفّذين (PP-19.1)، و@Require بياخد صلاحية واحدة؛ فالإذن والميزة
  // بيتفحصوا جوه معاملة القراءة نفسها (pickerAccess ثم pickerAllowed)، وده إعلان الوصول بتاع المسار ده.
  @Get('performer-options')
  @UseFilters(new SessionErrorsFilter(400))
  @Authenticated()
  @UseGuards(SelectedCompanyGuard, SessionAdminGuard)
  async performers(@Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('branchId', new ZodValidationPipe(id.toLowerCase())) branchId: string,
    @Query(new ZodValidationPipe(sessionPerformerOptionsQuery)) query: SessionPerformerOptionsQuery,
    @Req() request: FastifyRequest) {
    if (this.performerOptions === null) throw new ApiError('NOT_READY');
    // @Require كان بيحط الفرع في سياق اللوج؛ @Authenticated ما بيحطوش، فسطور اللوج تفضل فيها branch_id (CLAUDE.md §8).
    updateRequestContext({ branchId });
    try { return await this.performerOptions.execute({ ...actorOf(request), businessId, branchId }, query); }
    catch (error) {
      if (error instanceof RangeError && error.message === 'SESSION_PERFORMER_CURSOR_INVALID') throw new ApiError('VALIDATION_FAILED');
      if (error instanceof RecordingContextReadError) throw new ApiError(error.code);
      throw error;
    }
  }
  @Get('service-options')
  @Require('record:service-sessions:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SelectedCompanyGuard, SessionAdminGuard)
  async services(@Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('branchId', new ZodValidationPipe(id.toLowerCase())) branchId: string,
    @Query(new ZodValidationPipe(sessionServiceOptionsQuery)) query: SessionServiceOptionsQuery,
    @Req() request: FastifyRequest) {
    if (this.options === null) throw new ApiError('NOT_READY');
    try { return await this.options.execute({ ...actorOf(request), businessId, branchId }, query); }
    catch (error) {
      if (error instanceof RangeError && error.message === 'SESSION_SERVICE_CURSOR_INVALID') throw new ApiError('VALIDATION_FAILED');
      if (error instanceof RecordingContextReadError) throw new ApiError(error.code);
      throw error;
    }
  }
  // نفس إعلان قايمة المحرر: الإذن (تسجيل أو تغيير منفّذين) والميزة بيتفحصوا جوه المعاملة (PP-19.1).
  @Get('recording-context')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard, SessionAdminGuard)
  async read(@Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('branchId', new ZodValidationPipe(id.toLowerCase())) branchId: string,
    @Query(new ZodValidationPipe(recordingContextQuery)) query: RecordingContextQuery,
    @Req() request: FastifyRequest) {
    if (this.context === null) throw new ApiError('NOT_READY');
    updateRequestContext({ branchId });
    try { return await this.context.execute({ ...actorOf(request), businessId, branchId }, query); }
    catch (error) {
      if (error instanceof RecordingContextReadError) throw new ApiError(error.code);
      throw error;
    }
  }
}
