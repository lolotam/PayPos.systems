import { Body, Controller, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { id, refundPackageInput, type RefundPackageInput } from '@pospay/contracts';
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
import {
  PackageRefundError,
  PackageRuleError,
  RefundPackageUseCase,
  SessionError,
} from '../use-cases/refund-package/refund-package.usecase.ts';
import { SessionAdminGuard } from './session-access.guard.ts';

function fingerprint(
  request: FastifyRequest,
  body: unknown,
  businessId: string,
  branchId: string,
  entitlementId: string,
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
      entitlementId,
    },
  });
}

@Controller('businesses/:businessId/branches/:branchId/packages')
export class PackageRefundController {
  constructor(
    @Inject(RefundPackageUseCase)
    private readonly refundPackage: RefundPackageUseCase | null,
  ) {}

  @Post(':entitlementId/refunds')
  @HttpCode(201)
  @Require('refund:packages:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SessionAdminGuard)
  async refund(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('branchId', new ZodValidationPipe(id.toLowerCase())) branchId: string,
    @Param('entitlementId', new ZodValidationPipe(id.toLowerCase())) entitlementId: string,
    @Body(new ZodValidationPipe(refundPackageInput)) input: RefundPackageInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.refundPackage === null) throw new ApiError('NOT_READY');
    try {
      return await this.refundPackage.execute({
        ...actorOf(request),
        businessId,
        branchId,
        entitlementId,
        input,
        key: idem.key,
        fingerprint: fingerprint(request, input, businessId, branchId, entitlementId),
      });
    } catch (error) {
      return mapPackageRefundError(error);
    }
  }
}

function mapPackageRefundError(error: unknown): never {
  if (error instanceof PackageRefundError) throw new ApiError(error.code);
  if (error instanceof SessionError && isMappedSessionCode(error.code)) {
    throw new ApiError(error.code);
  }
  if (error instanceof PackageRuleError) {
    if (error.code === 'INVALID_SESSIONS') throw new ApiError('VALIDATION_FAILED');
    if (error.code === 'PACKAGE_EXPIRED' || error.code === 'INSUFFICIENT_SLOTS') {
      throw new ApiError(error.code);
    }
  }
  throw error;
}

function isMappedSessionCode(
  code: string,
): code is
  | 'FORBIDDEN'
  | 'FEATURE_DISABLED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'TRANSACTION_RETRY_REQUIRED'
  | 'VALIDATION_FAILED' {
  return (
    code === 'FORBIDDEN' ||
    code === 'FEATURE_DISABLED' ||
    code === 'IDEMPOTENCY_KEY_REUSED' ||
    code === 'TRANSACTION_RETRY_REQUIRED' ||
    code === 'VALIDATION_FAILED'
  );
}
