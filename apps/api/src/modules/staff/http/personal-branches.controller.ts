import { Controller, Get, Header, Inject, Query, Req, SetMetadata } from '@nestjs/common';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { PERSONAL_ROUTE } from '../../../shared/personal-authentication.ts';
import type { Clock } from '../../../shared/ports/clock.port.ts';
import {
  PERSONAL_BRANCH_READS,
  readPersonalBranches,
  type PersonalBranchReads,
} from '../queries/personal-branches.query.ts';
export const PERSONAL_BRANCH_CLOCK = Symbol('PERSONAL_BRANCH_CLOCK');

@Controller('staff/me/branches')
export class PersonalBranchesController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(PERSONAL_BRANCH_READS) private readonly reads: PersonalBranchReads,
    @Inject(PERSONAL_BRANCH_CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  @Authenticated()
  @SetMetadata(PERSONAL_ROUTE, true)
  @Header('Cache-Control', 'no-store')
  async read(@Query() query: Record<string, unknown>, @Req() request: FastifyRequest) {
    const session = request.personalSession;
    if (!session || !request.personalEmployeeId) throw new ApiError('UNAUTHENTICATED');
    if (Object.keys(query).length > 0) throw new ApiError('FORBIDDEN');
    if (!this.database) throw new ApiError('NOT_READY');
    const context = {
      ...session.context,
      userId: session.userId,
      employeeId: request.personalEmployeeId,
    };
    const now = this.clock.now();
    return this.database.withTenant(
      context.companyId,
      (tx) => readPersonalBranches(tx, context, now, this.reads),
      { userId: context.userId },
    );
  }
}
