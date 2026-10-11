import { Controller, Get, Inject, Param, Query, Req, UseFilters } from '@nestjs/common';
import {
  attendanceBoardQuery,
  attendanceBoardRefusalsQuery,
  id,
  type AttendanceBoardQuery,
  type AttendanceBoardRefusalsQuery,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import type { Clock } from '../../../shared/ports/clock.port.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
// eslint-disable-next-line boundaries/dependencies -- عقد القراءة مملوك لـ ports؛ المتحكم يحتاج نوعه فقط لحقن المحوّل.
import type { AttendanceBoardContext } from '../ports/attendance-board-context.port.ts';
import { attendanceBoard } from '../queries/attendance-board.query.ts';
import { attendanceDeviceRefusals } from '../queries/attendance-device-refusals.query.ts';
import { AttendanceBoardExceptionFilter } from './attendance-board-exception.filter.ts';

export const ATTENDANCE_BOARD_CONTEXT = Symbol('ATTENDANCE_BOARD_CONTEXT');
export const ATTENDANCE_BOARD_CLOCK = Symbol('ATTENDANCE_BOARD_CLOCK');
@Controller('businesses/:businessId/branches/:branchId/attendance-board')
@UseFilters(AttendanceBoardExceptionFilter)
export class AttendanceBoardController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(ATTENDANCE_BOARD_CONTEXT) private readonly context: AttendanceBoardContext,
    @Inject(ATTENDANCE_BOARD_CLOCK) private readonly clock: Clock,
  ) {}
  @Get()
  @Require('read:attendance:branch', { branch: 'branchId' })
  @RequiresFeature('staff')
  async board(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Query(new ZodValidationPipe(attendanceBoardQuery)) query: AttendanceBoardQuery,
    @Req() request: FastifyRequest,
  ) {
    if (!this.database) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const now = this.clock.now();
    return this.database.withTenant(
      actor.companyId,
      async (tx) => {
        const scope = await this.context(tx, actor.companyId, businessId, branchId);
        if (!scope) throw new ApiError('NOT_FOUND');
        return attendanceBoard(tx, scope, now, query.date);
      },
      { userId: actor.userId },
    );
  }
  @Get('refusals')
  @Require('read:attendance:branch', { branch: 'branchId' })
  @RequiresFeature('staff')
  async refusals(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Query(new ZodValidationPipe(attendanceBoardRefusalsQuery)) query: AttendanceBoardRefusalsQuery,
    @Req() request: FastifyRequest,
  ) {
    if (!this.database) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    return this.database.withTenant(
      actor.companyId,
      async (tx) => {
        const scope = await this.context(tx, actor.companyId, businessId, branchId);
        if (!scope) throw new ApiError('NOT_FOUND');
        const [attemptedAt, id] = query.cursor?.split('|') ?? [];
        return attendanceDeviceRefusals(tx, {
          ...scope,
          limit: query.limit,
          ...(attemptedAt && id ? { cursor: { attemptedAt, id } } : {}),
        });
      },
      { userId: actor.userId },
    );
  }
}
