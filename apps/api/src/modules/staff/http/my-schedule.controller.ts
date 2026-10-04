import { Controller, Get, Inject, Query, Req, SetMetadata } from '@nestjs/common';
import { personalScheduleQuery } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { PERSONAL_ROUTE } from '../../../shared/personal-authentication.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { validateMyScheduleWeek } from '../use-cases/read-my-schedule/read-my-schedule.ts';

import { mySchedule } from '../queries/my-schedule.query.ts';

@Controller('staff/my-schedule')
export class MyScheduleController {
  constructor(@Inject(DATABASE) private readonly database: TenantWrappers | null) {}

  @Get()
  @Authenticated()
  @SetMetadata(PERSONAL_ROUTE, true)
  async read(
    @Query(new ZodValidationPipe(personalScheduleQuery))
    query: { week_start: string; branch_id: string },
    @Req() request: FastifyRequest,
  ) {
    const session = request.personalSession;
    if (session === undefined || request.personalEmployeeId === undefined)
      throw new ApiError('UNAUTHENTICATED');
    if (this.database === null) throw new ApiError('NOT_READY');
    if (!validateMyScheduleWeek(query.week_start)) throw new ApiError('SCHEDULE_WEEK_INVALID');
    const employeeId = request.personalEmployeeId;
    const result = await this.database.withTenant(
      session.context.companyId,
      (tx) =>
        mySchedule(
          tx,
          session.context.companyId,
          session.context.businessId,
          query.branch_id,
          employeeId,
          query.week_start,
        ),
      { userId: session.userId },
    );
    if (typeof result === 'string') throw new ApiError(result);
    return result;
  }
}
