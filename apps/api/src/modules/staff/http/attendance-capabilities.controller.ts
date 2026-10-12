import { Controller, Get, Inject, Param, Req, UseFilters } from '@nestjs/common';
import { id } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { REQUEST_AUTHORIZER, type RequestAuthorizer } from '../../../shared/request-authorizer.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { readAttendanceCapabilities } from '../queries/attendance-capabilities.query.ts';
import {
  ATTENDANCE_BOARD_CONTEXT,
  type AttendanceBoardContext,
} from './attendance-board.controller.ts';
import { AttendanceBoardExceptionFilter } from './attendance-board-exception.filter.ts';

@Controller('businesses/:businessId/branches/:branchId/attendance-capabilities')
@UseFilters(AttendanceBoardExceptionFilter)
export class AttendanceCapabilitiesController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(ATTENDANCE_BOARD_CONTEXT) private readonly context: AttendanceBoardContext,
    @Inject(REQUEST_AUTHORIZER) private readonly authorizer: RequestAuthorizer | null,
  ) {}
  @Get()
  @Require('read:attendance:branch', { branch: 'branchId' })
  @RequiresFeature('staff')
  async read(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!this.database || !this.authorizer) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const scope = await this.database.withTenant(
      actor.companyId,
      (tx) => this.context(tx, actor.companyId, businessId, branchId),
      { userId: actor.userId },
    );
    if (!scope) throw new ApiError('NOT_FOUND');
    return readAttendanceCapabilities(this.authorizer, scope, actor.userId);
  }
}
