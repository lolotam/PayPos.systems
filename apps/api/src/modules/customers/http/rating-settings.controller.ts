import { Body, Controller, Get, Inject, Param, Put, Req } from '@nestjs/common';
import { id, ratingSettings, type RatingSettings as RatingSettingsDto } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { ratingSettingsQuery } from '../queries/rating-settings.query.ts';
import { SetRatingRequests } from '../use-cases/set-rating-requests/set-rating-requests.usecase.ts';

@Controller()
export class RatingSettingsController {
  readonly #db: TenantWrappers | null;
  readonly #set: SetRatingRequests | null;

  constructor(
    @Inject(DATABASE) db: TenantWrappers | null,
    @Inject(SetRatingRequests) set: SetRatingRequests | null,
  ) {
    this.#db = db;
    this.#set = set;
  }

  @Get('businesses/:businessId/rating-settings')
  @Require('manage:rating-requests:business', { business: 'businessId' })
  read(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Req() request: FastifyRequest,
  ): Promise<RatingSettingsDto> {
    if (this.#db === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const business = businessId.toLowerCase();
    return this.#db.withTenant(
      actor.companyId,
      (tx) => ratingSettingsQuery(tx, actor.companyId, business),
      { userId: actor.userId },
    );
  }

  @Put('businesses/:businessId/rating-settings')
  @Require('manage:rating-requests:business', { business: 'businessId' })
  set(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new ZodValidationPipe(ratingSettings)) input: RatingSettingsDto,
    @Req() request: FastifyRequest,
  ): Promise<RatingSettingsDto> {
    const useCase = this.#set;
    if (useCase === null) throw new ApiError('NOT_READY');
    return useCase.execute(actorOf(request), businessId.toLowerCase(), input.requests_enabled);
  }
}
