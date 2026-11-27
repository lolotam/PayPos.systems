import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import {
  createBranchInput,
  id,
  setBranchOpeningHoursInput,
  type Branch,
  type CreateBranchInput,
  type SetBranchOpeningHoursInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Require } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { branchDetail } from '../queries/branch-detail.query.ts';
import { CreateBranch } from '../use-cases/create-branch/create-branch.ts';
import { SetBranchOpeningHours } from '../use-cases/set-branch-opening-hours/set-branch-opening-hours.ts';

@Controller()
export class BranchesController {
  readonly #create: CreateBranch | null;
  readonly #db: TenantWrappers | null;
  readonly #hours: SetBranchOpeningHours | null;

  constructor(
    @Inject(CreateBranch) create: CreateBranch | null,
    @Inject(DATABASE) db: TenantWrappers | null,
    @Inject(SetBranchOpeningHours) hours: SetBranchOpeningHours | null,
  ) {
    this.#create = create;
    this.#db = db;
    this.#hours = hours;
  }

  @Post('businesses/:businessId/branches')
  @Require('create:branches:business', { business: 'businessId' })
  async create(
    // The access guard already proved this business is the verified company's.
    @Param('businessId') businessId: string,
    @Body(new ZodValidationPipe(createBranchInput)) input: CreateBranchInput,
    @Idempotency() idempotency: IdempotencyInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    if (this.#create === null) throw new ApiError('NOT_READY');
    const result = await this.#create.execute({
      ...actorOf(request),
      businessId: businessId.toLowerCase(),
      input,
      idempotency,
    });
    void reply.status(result.status);
    if (result.replayed) void reply.header('idempotent-replayed', 'true');
    return result.body;
  }

  @Get('branches/:branchId')
  @Require('read:branches:branch', { branch: 'branchId' })
  async detail(
    @Param('branchId') branchId: string,
    @Req() request: FastifyRequest,
  ): Promise<Branch> {
    if (this.#db === null) throw new ApiError('NOT_READY');
    const branch = await branchDetail(this.#db, actorOf(request), branchId.toLowerCase());
    if (branch === null) throw new ApiError('NOT_FOUND');
    return branch;
  }

  @Put('businesses/:businessId/branches/:branchId/opening-hours')
  @HttpCode(200)
  @Require('create:branches:business', { business: 'businessId' })
  async setOpeningHours(
    // The access guard already proved this business is the verified company's; the branch is checked under it.
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Body(new ZodValidationPipe(setBranchOpeningHoursInput)) input: SetBranchOpeningHoursInput,
    @Req() request: FastifyRequest,
  ): Promise<Branch> {
    if (this.#hours === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const result = await this.#hours.execute({
      companyId: actor.companyId,
      userId: actor.userId,
      businessId: businessId.toLowerCase(),
      branchId: branchId.toLowerCase(),
      input,
    });
    if (result === null) throw new ApiError('NOT_FOUND');
    return result.body as Branch;
  }
}
