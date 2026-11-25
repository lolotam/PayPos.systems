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
import { PrivateViewRoute } from '../../../shared/private-view.guard.ts';
import type { Clock } from '../../../shared/ports/clock.port.ts';
import { STAFF_ROUTE } from '../../../shared/staff-authentication.ts';
import {
  OWN_COMMISSION_ESTIMATE_READS,
  type OwnCommissionEstimateReads,
} from '../queries/own-commission-estimate-context.ts';
import { readOwnCommissionEstimate } from '../queries/own-commission-estimate.query.ts';

export const OWN_COMMISSION_ESTIMATE_CLOCK = Symbol('OWN_COMMISSION_ESTIMATE_CLOCK');

@Catch()
class OwnCommissionEstimateErrorsFilter extends EnvelopeExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<FastifyReply>().header('Cache-Control', 'no-store');
    super.catch(exception, host);
  }
}

@Controller('staff/me')
@UseFilters(new OwnCommissionEstimateErrorsFilter())
export class OwnCommissionEstimateController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(OWN_COMMISSION_ESTIMATE_READS) private readonly reads: OwnCommissionEstimateReads,
    @Inject(OWN_COMMISSION_ESTIMATE_CLOCK) private readonly clock: Clock,
  ) {}

  // لقطة قراءة واحدة (READ ONLY): السلطة والنافذة وبوابة العمود والإسقاط من نفس الحالة.
  @Get('commission-estimate')
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'staff')
  @SetMetadata(PERSONAL_ROUTE, 'staff')
  @PrivateViewRoute()
  @Header('Cache-Control', 'no-store')
  estimate(@Query() query: unknown, @Req() request: FastifyRequest) {
    const session = request.staffSession ?? request.personalSession;
    if (!session) throw new ApiError('UNAUTHENTICATED');
    if (!this.database) throw new ApiError('NOT_READY');
    const now = this.clock.now();
    const context = {
      companyId: session.context.companyId,
      businessId: session.context.businessId,
      userId: session.userId,
      ...(request.staffDevice ? { branchId: request.staffDevice.branchId } : {}),
    };
    return this.database.withTenant(
      context.companyId,
      (tx) => readOwnCommissionEstimate(tx, context, query, now, this.reads),
      { userId: context.userId, readOnly: true },
    );
  }
}
