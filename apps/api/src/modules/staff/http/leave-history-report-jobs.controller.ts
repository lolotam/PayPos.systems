import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  id,
  leaveHistoryReportRequest,
  leaveHistoryReportResultQuery,
  type LeaveHistoryReportRequest,
  type LeaveHistoryReportResultQuery,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  LEAVE_HISTORY_REPORT_RESULT_READER,
  type LeaveHistoryReportResultReader,
} from '../queries/leave-history-report-result.query.ts';
import {
  LeaveHistoryReportRequestError,
  RequestLeaveHistoryReportUseCase,
} from '../use-cases/request-leave-history-report/request-leave-history-report.usecase.ts';

@Controller('businesses/:businessId/leave-history/reports')
export class LeaveHistoryReportJobsController {
  constructor(
    @Inject(RequestLeaveHistoryReportUseCase)
    private readonly requestReport: RequestLeaveHistoryReportUseCase | null,
    @Inject(LEAVE_HISTORY_REPORT_RESULT_READER)
    private readonly resultReader: LeaveHistoryReportResultReader,
  ) {}

  @Post()
  @HttpCode(202)
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async request(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new ZodValidationPipe(leaveHistoryReportRequest)) input: LeaveHistoryReportRequest,
    @Req() req: FastifyRequest,
  ) {
    if (this.requestReport === null) throw new ApiError('NOT_READY');
    try {
      return await this.requestReport.execute({
        ...input,
        ...actorOf(req),
        businessId,
      });
    } catch (error) {
      if (error instanceof LeaveHistoryReportRequestError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Get(':reportId')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async result(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('reportId', new ZodValidationPipe(id)) reportId: string,
    @Query(new ZodValidationPipe(leaveHistoryReportResultQuery)) query: LeaveHistoryReportResultQuery,
    @Req() req: FastifyRequest,
  ) {
    const context = { ...actorOf(req), businessId, own: false };
    const result = await this.resultReader.execute(context, reportId, query);
    if (result === null) throw new ApiError('NOT_FOUND');
    if (result === 'VALIDATION_FAILED')
      throw new ApiError(result, [{ path: ['cursor'], code: 'custom' }]);
    if (typeof result === 'string') throw new ApiError(result);
    return result;
  }
}
