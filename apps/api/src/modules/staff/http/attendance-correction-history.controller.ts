import { Controller, Get, Inject, Param, Req, UseFilters } from '@nestjs/common';
import { id } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { attendanceCorrectionHistory } from '../queries/attendance-correction-history.query.ts';
import {
  ATTENDANCE_BOARD_CONTEXT,
  type AttendanceBoardContext,
} from './attendance-board.controller.ts';
import { AttendanceBoardExceptionFilter } from './attendance-board-exception.filter.ts';

@Controller('businesses/:businessId/branches/:branchId/attendance-sessions/:sessionId/corrections')
@UseFilters(AttendanceBoardExceptionFilter)
export class AttendanceCorrectionHistoryController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(ATTENDANCE_BOARD_CONTEXT) private readonly context: AttendanceBoardContext,
  ) {}
  @Get()
  @Require('read:attendance:branch', { branch: 'branchId' })
  @RequiresFeature('staff')
  async history(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Param('sessionId', new ZodValidationPipe(id)) sessionId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!this.database) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    return this.database.withTenant(
      actor.companyId,
      async (tx) => {
        const scope = await this.context(tx, actor.companyId, businessId, branchId);
        if (!scope) throw new ApiError('NOT_FOUND');
        const result = await attendanceCorrectionHistory(tx, scope, sessionId);
        if (!result) throw new ApiError('NOT_FOUND');
        return result;
      },
      { userId: actor.userId },
    );
  }
}
