import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import {
  createBusinessInput,
  pageQuery,
  setBusinessCountryInput,
  type Business,
  type CreateBusinessInput,
  type PageQuery,
  type SetBusinessCountryInput,
  type SetBusinessCountryResult,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Require } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { InvalidCursorError, listBusinesses } from '../queries/list-businesses.query.ts';
import { CreateBusiness } from '../use-cases/create-business/create-business.ts';
import { SetBusinessCountry } from '../use-cases/set-business-country/set-business-country.ts';

@Controller('businesses')
export class BusinessesController {
  readonly #create: CreateBusiness | null;
  readonly #db: TenantWrappers | null;
  readonly #country: SetBusinessCountry | null;

  constructor(
    @Inject(CreateBusiness) create: CreateBusiness | null,
    @Inject(DATABASE) db: TenantWrappers | null,
    @Inject(SetBusinessCountry) country: SetBusinessCountry | null,
  ) {
    this.#create = create;
    this.#db = db;
    this.#country = country;
  }

  @Post()
  @Require('create:businesses:company')
  async create(
    @Body(new ZodValidationPipe(createBusinessInput)) input: CreateBusinessInput,
    @Idempotency() idempotency: IdempotencyInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    if (this.#create === null) throw new ApiError('NOT_READY');
    const result = await this.#create.execute({ ...actorOf(request), input, idempotency });
    void reply.status(result.status);
    if (result.replayed) void reply.header('idempotent-replayed', 'true');
    return result.body;
  }

  @Get()
  @Require('read:businesses:company')
  async list(
    @Query(new ZodValidationPipe(pageQuery)) page: PageQuery,
    @Req() request: FastifyRequest,
  ): Promise<{ items: Business[]; next_cursor: string | null }> {
    if (this.#db === null) throw new ApiError('NOT_READY');
    try {
      return await listBusinesses(this.#db, actorOf(request), page);
    } catch (error) {
      if (error instanceof InvalidCursorError) {
        throw new ApiError('VALIDATION_FAILED', [{ path: ['cursor'], code: 'invalid_cursor' }]);
      }
      throw error;
    }
  }

  @Put(':businessId/country')
  @HttpCode(200)
  @Require('manage:settings:business', { business: 'businessId' })
  async setCountry(
    @Param('businessId') businessId: string,
    @Body(new ZodValidationPipe(setBusinessCountryInput)) input: SetBusinessCountryInput,
    @Req() request: FastifyRequest,
  ): Promise<SetBusinessCountryResult> {
    if (this.#country === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const result = await this.#country.execute({
      companyId: actor.companyId,
      userId: actor.userId,
      businessId: businessId.toLowerCase(),
      country: input.country,
    });
    if (result === null) throw new ApiError('NOT_FOUND');
    return result.body as SetBusinessCountryResult;
  }
}
