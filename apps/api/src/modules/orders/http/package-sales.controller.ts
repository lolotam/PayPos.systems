import { Body, Controller, HttpCode, Inject, Param, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { id, sellPackageInput, type SellPackageInput } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, requestFingerprint, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { SellPackageUseCase } from '../use-cases/sell-package/sell-package.usecase.ts';
import { PackageSaleErrorsFilter } from './package-sale-errors.filter.ts';
import { SessionAdminGuard } from './session-access.guard.ts';
import { SessionErrorsFilter } from './session-errors.filter.ts';

function fingerprint(
  request: FastifyRequest,
  body: unknown,
  businessId: string,
  branchId: string,
): string {
  const actor = actorOf(request);
  return requestFingerprint({
    method: request.method,
    route: request.routeOptions.url ?? request.url,
    query: request.query,
    body,
    params: { businessId, branchId, companyId: actor.companyId, actorUserId: actor.userId },
  });
}
@Controller('businesses/:businessId/branches/:branchId/package-sales')
@UseFilters(SessionErrorsFilter, PackageSaleErrorsFilter)
export class PackageSalesController {
  constructor(@Inject(SellPackageUseCase) private readonly sell: SellPackageUseCase | null) {}

  @Post()
  @HttpCode(201)
  @Require('sell:packages:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SessionAdminGuard)
  async create(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('branchId', new ZodValidationPipe(id.toLowerCase())) branchId: string,
    @Body(new ZodValidationPipe(sellPackageInput)) input: SellPackageInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.sell === null) throw new ApiError('NOT_READY');
    return this.sell.execute(
      {
        ...actorOf(request),
        businessId,
        branchId,
        key: idem.key,
        fingerprint: fingerprint(request, input, businessId, branchId),
      },
      input,
    );
  }
}
