import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { id, leaveHistoryReportQuery, type LeaveHistoryReportQuery } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  LEAVE_HISTORY_REPORT_READER,
  type LeaveHistoryReportReader,
} from '../queries/leave-history-report.query.ts';

@Controller('businesses/:businessId/leave-history')
export class LeaveHistoryReportController {
  constructor(
    @Inject(LEAVE_HISTORY_REPORT_READER) private readonly reader: LeaveHistoryReportReader,
  ) {}
  @Get()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async list(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Query(new ZodValidationPipe(leaveHistoryReportQuery)) query: LeaveHistoryReportQuery,
    @Req() req: FastifyRequest,
  ) {
    const context = { ...actorOf(req), businessId, own: false };
    const result = await this.reader.execute(context, query);
    if (result === null) throw new ApiError('NOT_FOUND');
    if (result === 'VALIDATION_FAILED')
      throw new ApiError(result, [{ path: ['cursor'], code: 'custom' }]);
    if (typeof result === 'string') throw new ApiError(result);
    return result;
  }
}
