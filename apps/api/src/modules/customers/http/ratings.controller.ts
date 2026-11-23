import { Controller, Get, Header, Inject, Param, Query, Req } from '@nestjs/common';
import { id } from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import type { Clock } from '../../../shared/ports/clock.port.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { readRatingAverages } from '../queries/rating-averages.query.ts';
import { readAsMemberOfOpenCompany } from '../../../shared/open-company-member-read.ts';
import {
  RATINGS_LIST_READS,
  type RatingsListReads,
  type RatingsListScope,
} from '../queries/ratings-list-reads.ts';
import { readRatingsList } from '../queries/ratings-list.query.ts';
import { selectedCompanyOf } from './ratings-company.ts';

export const RATINGS_LIST_CLOCK = Symbol('RATINGS_LIST_CLOCK');

/**
 * قراءة التقييمات للمديرين: القرار بيعتمد على دور المستخدم الحالي ونطاقه فالمسار `@Authenticated()`،
 * وإثبات العضوية والشركة المفتوحة والفحص والصفحة في معاملة قراءة واحدة بلقطة ثابتة (CLAUDE.md §6، T8)؛ فمفيش
 * SelectedCompanyGuard هنا لأنه كان بيفتح معاملة لوحده قبل معاملة القراءة.
 */
@Controller()
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
    return this.read(businessId, request, (tx, context, now) =>
      readRatingsList(tx, context, query, now, this.reads),
    );
  }

  @Get('businesses/:businessId/ratings/averages')
  @Authenticated()
  @Header('Cache-Control', 'no-store')
  averages(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.read(businessId, request, (tx, context, now) =>
      readRatingAverages(tx, context, query, now, this.reads),
    );
  }

  private read<T>(
    businessId: string,
    request: FastifyRequest,
    run: (tx: Tx, context: RatingsListScope, now: Date) => Promise<T>,
  ): Promise<T> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const who = selectedCompanyOf(request);
    const context = { ...who, businessId: businessId.toLowerCase() };
    const now = this.clock.now();
    return readAsMemberOfOpenCompany(this.database, who, (tx) => run(tx, context, now));
  }
}
