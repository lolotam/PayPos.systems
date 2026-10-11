import { Controller, Get, Inject, Param, Query, Req, UseFilters } from '@nestjs/common';
import {
  attendanceExceptionsListQuery,
  id,
  type AttendanceExceptionsListQuery,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { attendanceExceptions } from '../queries/attendance-exceptions.query.ts';
import {
  ATTENDANCE_BOARD_CONTEXT,
  type AttendanceBoardContext,
} from './attendance-board.controller.ts';
import { AttendanceBoardExceptionFilter } from './attendance-board-exception.filter.ts';

@Controller('businesses/:businessId/branches/:branchId/attendance-exceptions')
@UseFilters(AttendanceBoardExceptionFilter)
export class AttendanceExceptionsReadController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(ATTENDANCE_BOARD_CONTEXT) private readonly context: AttendanceBoardContext,
  ) {}
  @Get()
  @Require('read:attendance:branch', { branch: 'branchId' })
  @RequiresFeature('staff')
  async list(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Query(new ZodValidationPipe(attendanceExceptionsListQuery))
    query: AttendanceExceptionsListQuery,
    @Req() request: FastifyRequest,
  ) {
    if (!this.database) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    return this.database.withTenant(
      actor.companyId,
      async (tx) => {
        const scope = await this.context(tx, actor.companyId, businessId, branchId);
        if (!scope) throw new ApiError('NOT_FOUND');
        return attendanceExceptions(tx, scope, query);
      },
      { userId: actor.userId },
    );
  }
}
