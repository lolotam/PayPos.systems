import { Controller, Get, Header, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { id } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import type { Clock } from '../../../shared/ports/clock.port.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { RATINGS_LIST_READS, type RatingsListReads } from '../queries/ratings-list-reads.ts';
import { readRatingsList } from '../queries/ratings-list.query.ts';

export const RATINGS_LIST_CLOCK = Symbol('RATINGS_LIST_CLOCK');

/**
 * قراءة التقييمات للمديرين: القرار بيعتمد على دور المستخدم الحالي ونطاقه فالمسار `@Authenticated()`،
 * والفحص والصفحة في معاملة قراءة واحدة بلقطة ثابتة (CLAUDE.md §6، T8).
 */
@Controller()
@UseGuards(SelectedCompanyGuard)
export class RatingsController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(RATINGS_LIST_READS) private readonly reads: RatingsListReads,
    @Inject(RATINGS_LIST_CLOCK) private readonly clock: Clock,
  ) {}

  @Get('businesses/:businessId/ratings')
  @Authenticated()
  @Header('Cache-Control', 'no-store')
  list(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ) {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const context = { ...actor, businessId: businessId.toLowerCase() };
    const now = this.clock.now();
    return this.database.withTenant(
      actor.companyId,
      (tx) => readRatingsList(tx, context, query, now, this.reads),
      { userId: actor.userId, readOnly: true },
    );
  }
}
