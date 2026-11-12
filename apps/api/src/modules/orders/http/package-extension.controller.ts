import { Body, Controller, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { extendPackageInput, id, type ExtendPackageInput } from '@pospay/contracts';
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
  ExtendPackageUseCase,
  PackageExtensionError,
  PackageRuleError,
  SessionError,
} from '../use-cases/extend-package/extend-package.usecase.ts';
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
export class PackageExtensionController {
  constructor(
    @Inject(ExtendPackageUseCase)
    private readonly extendPackage: ExtendPackageUseCase | null,
  ) {}

  @Post(':entitlementId/extensions')
  @HttpCode(201)
  @Require('extend:packages:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SessionAdminGuard)
  async extend(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('branchId', new ZodValidationPipe(id.toLowerCase())) branchId: string,
    @Param('entitlementId', new ZodValidationPipe(id.toLowerCase())) entitlementId: string,
    @Body(new ZodValidationPipe(extendPackageInput)) input: ExtendPackageInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.extendPackage === null) throw new ApiError('NOT_READY');
    try {
      return await this.extendPackage.execute({
        ...actorOf(request),
        businessId,
        branchId,
        entitlementId,
        input,
        key: idem.key,
        fingerprint: fingerprint(request, input, businessId, branchId, entitlementId),
      });
    } catch (error) {
      return mapPackageExtensionError(error);
    }
  }
}

function mapPackageExtensionError(error: unknown): never {
  if (error instanceof PackageExtensionError) throw new ApiError(error.code);
  if (error instanceof SessionError && isMappedSessionCode(error.code)) {
    throw new ApiError(error.code);
  }
  if (error instanceof PackageRuleError) {
    if (error.code === 'INVALID_DATE') throw new ApiError('VALIDATION_FAILED');
    if (
      error.code === 'PACKAGE_EXTENSION_NOT_LATER' ||
      error.code === 'PACKAGE_EXTENSION_TOO_LONG'
    ) {
      throw new ApiError(error.code);
    }
  }
  throw error;
}

function isMappedSessionCode(
  code: string,
): code is 'FORBIDDEN' | 'FEATURE_DISABLED' | 'IDEMPOTENCY_KEY_REUSED' | 'VALIDATION_FAILED' {
  return (
    code === 'FORBIDDEN' ||
    code === 'FEATURE_DISABLED' ||
    code === 'IDEMPOTENCY_KEY_REUSED' ||
    code === 'VALIDATION_FAILED'
  );
}
