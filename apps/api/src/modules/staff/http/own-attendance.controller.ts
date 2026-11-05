import { Controller, Get, Header, Inject, Query, Req, SetMetadata } from '@nestjs/common';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { PERSONAL_ROUTE } from '../../../shared/personal-authentication.ts';
import { STAFF_ROUTE } from '../../../shared/staff-authentication.ts';
import { PrivateViewRoute } from '../../../shared/private-view.guard.ts';
import type { Clock } from '../../../shared/ports/clock.port.ts';
export const OWN_ATTENDANCE_CLOCK = Symbol('OWN_ATTENDANCE_CLOCK');
import {
  readOwnAttendance,
  OWN_ATTENDANCE_READS,
  type OwnAttendanceReads,
} from '../queries/own-attendance.query.ts';

@Controller('staff/me/attendance')
export class OwnAttendanceController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(OWN_ATTENDANCE_READS) private readonly reads: OwnAttendanceReads,
    @Inject(OWN_ATTENDANCE_CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'staff')
  @SetMetadata(PERSONAL_ROUTE, 'staff')
  @PrivateViewRoute()
  @Header('Cache-Control', 'no-store')
  async read(@Query() query: unknown, @Req() request: FastifyRequest) {
    const session = request.staffSession ?? request.personalSession;
    if (!session) throw new ApiError('UNAUTHENTICATED');
    if (!this.database) throw new ApiError('NOT_READY');
    const context = {
      companyId: session.context.companyId,
      businessId: session.context.businessId,
      userId: session.userId,
      ...(request.staffDevice ? { branchId: request.staffDevice.branchId } : {}),
    };
    const now = this.clock.now();
    return this.database.withTenant(
      context.companyId,
      (tx) => readOwnAttendance(tx, context, query, now, this.reads),
      { userId: context.userId },
    );
  }
}
