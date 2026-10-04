import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { id, leaveListQuery, type LeaveListQuery } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  LEAVE_READ_ACCESS,
  pendingLeaveInbox,
  type LeaveReadAccess,
} from '../queries/leave-requests.query.ts';
@Controller('businesses/:businessId/leave-requests')
export class LeaveInboxController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(LEAVE_READ_ACCESS) private readonly access: LeaveReadAccess,
  ) {}
  @Get()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async list(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Query(new ZodValidationPipe(leaveListQuery)) query: LeaveListQuery,
    @Req() req: FastifyRequest,
  ) {
    if (!this.database) throw new ApiError('NOT_READY');
    const context = { ...actorOf(req), businessId, own: false };
    const result = await this.database.withTenant(
      context.companyId,
      (tx) => pendingLeaveInbox(tx, context, query, this.access),
      { userId: context.userId },
    );
    if (result === null) throw new ApiError('NOT_FOUND');
    if (typeof result === 'string') throw new ApiError(result);
    return result;
  }
}
