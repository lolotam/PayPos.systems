import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { id, leaveHistoryQuery, type LeaveHistoryQuery } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { LEAVE_HISTORY_READER, type LeaveHistoryReader } from '../queries/leave-history.query.ts';

@Controller('businesses/:businessId/employees/:employeeId/leave-history')
export class EmployeeLeaveHistoryController {
  constructor(
    @Inject(LEAVE_HISTORY_READER) private readonly reader: LeaveHistoryReader,
  ) {}
  @Get()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async list(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Query(new ZodValidationPipe(leaveHistoryQuery)) query: LeaveHistoryQuery,
    @Req() req: FastifyRequest,
  ) {
    const context = { ...actorOf(req), businessId, employeeId, own: false };
    const result = await this.reader.execute(context, query);
    if (result === null) throw new ApiError('NOT_FOUND');
    if (result === 'VALIDATION_FAILED')
      throw new ApiError(result, [{ path: ['cursor'], code: 'custom' }]);
    if (typeof result === 'string') throw new ApiError(result);
    return result;
  }
}
