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
import type { Clock } from '../../../shared/ports/clock.port.ts';
import { OWN_RATING_READS, type OwnRatingReads } from '../queries/own-rating-context.ts';
import { readOwnRatingSummary } from '../queries/own-rating-summary.query.ts';

export const OWN_RATING_CLOCK = Symbol('OWN_RATING_CLOCK');

@Catch()
class OwnRatingErrorsFilter extends EnvelopeExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<FastifyReply>().header('Cache-Control', 'no-store');
    super.catch(exception, host);
  }
}

@Controller('staff/me')
@UseFilters(new OwnRatingErrorsFilter())
export class OwnRatingSummaryController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(OWN_RATING_READS) private readonly reads: OwnRatingReads,
    @Inject(OWN_RATING_CLOCK) private readonly clock: Clock,
  ) {}

  @Get('rating-summary')
  @Authenticated()
  @SetMetadata(PERSONAL_ROUTE, true)
  @Header('Cache-Control', 'no-store')
  ratingSummary(@Query() query: unknown, @Req() request: FastifyRequest) {
    const session = request.personalSession;
    if (!session) throw new ApiError('UNAUTHENTICATED');
    if (!this.database) throw new ApiError('NOT_READY');
    const context = {
      companyId: session.context.companyId,
      businessId: session.context.businessId,
      userId: session.userId,
    };
    const now = this.clock.now();
    // لقطة قراءة واحدة (REPEATABLE READ, READ ONLY): السلطة وبوابة العمود والمتوسط من نفس الحالة المثبتة.
    return this.database.withTenant(
      context.companyId,
      (tx) => readOwnRatingSummary(tx, context, query, now, this.reads),
      { userId: context.userId, readOnly: true },
    );
  }
}
