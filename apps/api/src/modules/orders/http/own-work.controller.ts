import {
  Catch,
  Controller,
  Get,
  Header,
  Inject,
  Query,
  Req,
  SetMetadata,
  UseFilters,
  type ArgumentsHost,
} from '@nestjs/common';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { EnvelopeExceptionFilter } from '../../../shared/exception.filter.ts';
import { PERSONAL_ROUTE } from '../../../shared/personal-authentication.ts';
import { STAFF_ROUTE } from '../../../shared/staff-authentication.ts';
import { PrivateViewRoute } from '../../../shared/private-view.guard.ts';
import type { Clock } from '../../../shared/ports/clock.port.ts';
import { OWN_WORK_READS, type OwnWorkReads } from '../queries/own-work-context.ts';
import { readOwnTips } from '../queries/own-tips.query.ts';

export const OWN_WORK_CLOCK = Symbol('OWN_WORK_CLOCK');

@Catch()
class OwnWorkErrorsFilter extends EnvelopeExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<FastifyReply>().header('Cache-Control', 'no-store');
    super.catch(exception, host);
  }
}

@Controller('staff/me')
@UseFilters(new OwnWorkErrorsFilter())
export class OwnWorkController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(OWN_WORK_READS) private readonly reads: OwnWorkReads,
    @Inject(OWN_WORK_CLOCK) private readonly clock: Clock,
  ) {}

  @Get('tips')
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'staff')
  @SetMetadata(PERSONAL_ROUTE, 'staff')
  @PrivateViewRoute()
  @Header('Cache-Control', 'no-store')
  tips(@Query() query: unknown, @Req() request: FastifyRequest) {
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
      (tx) => readOwnTips(tx, context, query, now, this.reads),
      { userId: context.userId },
    );
  }
}
