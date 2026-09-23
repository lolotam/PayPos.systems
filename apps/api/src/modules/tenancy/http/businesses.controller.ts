import { Body, Controller, Get, Inject, Post, Query, Req, Res } from '@nestjs/common';
import {
  createBusinessInput,
  pageQuery,
  type Business,
  type CreateBusinessInput,
  type PageQuery,
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

@Controller('businesses')
export class BusinessesController {
  readonly #create: CreateBusiness | null;
  readonly #db: TenantWrappers | null;

  constructor(
    @Inject(CreateBusiness) create: CreateBusiness | null,
    @Inject(DATABASE) db: TenantWrappers | null,
  ) {
    this.#create = create;
    this.#db = db;
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
}
