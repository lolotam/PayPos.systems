import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { id, leaveHistoryQuery, type LeaveHistoryQuery } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { LEAVE_READ_ACCESS, type LeaveReadAccess } from '../queries/leave-requests.query.ts';
import { getEmployeeLeaveHistory } from '../queries/leave-history.query.ts';

@Controller('businesses/:businessId/employees/:employeeId/leave-history')
export class EmployeeLeaveHistoryController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(LEAVE_READ_ACCESS) private readonly access: LeaveReadAccess,
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
    if (!this.database) throw new ApiError('NOT_READY');
    const context = { ...actorOf(req), businessId, employeeId, own: false };
    const result = await this.database.withTenant(
      context.companyId,
      (tx) => getEmployeeLeaveHistory(tx, context, query, this.access),
      { userId: context.userId },
    );
    if (result === null) throw new ApiError('NOT_FOUND');
    if (result === 'VALIDATION_FAILED')
      throw new ApiError(result, [{ path: ['cursor'], code: 'custom' }]);
    if (typeof result === 'string') throw new ApiError(result);
    return result;
  }
}
