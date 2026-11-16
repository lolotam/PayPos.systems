import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { id, sellPackageInput, type SellPackageInput } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import {
  Idempotency,
  requestFingerprint,
  type IdempotencyInput,
} from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { PackageSaleStatusQuery } from '../queries/package-sale-status.query.ts';
import {
  AcceptPackageSaleUseCase,
  SessionError,
} from '../use-cases/accept-package-sale/accept-package-sale.usecase.ts';
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
    params: {
      companyId: actor.companyId,
      actorUserId: actor.userId,
      businessId,
      branchId,
    },
  });
}

@Controller('businesses/:businessId/branches/:branchId/package-sales')
@UseFilters(new SessionErrorsFilter(400))
export class PackageSalesController {
  constructor(
    @Inject(AcceptPackageSaleUseCase)
    private readonly acceptPackageSale: AcceptPackageSaleUseCase | null,
    @Inject(PackageSaleStatusQuery)
    private readonly packageSaleStatus: PackageSaleStatusQuery | null,
  ) {}

  @Post()
  @HttpCode(202)
  @Require('sell:packages:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SessionAdminGuard)
  async accept(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('branchId', new ZodValidationPipe(id.toLowerCase())) branchId: string,
    @Body(new ZodValidationPipe(sellPackageInput)) input: SellPackageInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.acceptPackageSale === null) throw new ApiError('NOT_READY');
    try {
      return await this.acceptPackageSale.execute({
        ...actorOf(request),
        businessId,
        branchId,
        input,
        key: idem.key,
        fingerprint: fingerprint(request, input, businessId, branchId),
      });
    } catch (error) {
      return mapPackageSaleError(error);
    }
  }

  @Get(':saleRequestId')
  @Require('sell:packages:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SessionAdminGuard)
  status(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('branchId', new ZodValidationPipe(id.toLowerCase())) branchId: string,
    @Param('saleRequestId', new ZodValidationPipe(id.toLowerCase())) saleRequestId: string,
    @Req() request: FastifyRequest,
  ) {
    if (this.packageSaleStatus === null) throw new ApiError('NOT_READY');
    return this.packageSaleStatus.execute({
      ...actorOf(request),
      businessId,
      branchId,
      saleRequestId,
    });
  }
}

function mapPackageSaleError(error: unknown): never {
  if (!(error instanceof SessionError)) throw error;
  switch (error.code) {
    case 'SESSION_RECORDER_MEMBERSHIP_REQUIRED':
      throw error;
    case 'FORBIDDEN':
    case 'FEATURE_DISABLED':
    case 'IDEMPOTENCY_KEY_REUSED':
    case 'TRANSACTION_RETRY_REQUIRED':
      throw new ApiError(error.code, error.details);
    default:
      throw error;
  }
}
