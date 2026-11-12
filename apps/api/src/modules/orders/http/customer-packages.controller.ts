import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { customerPackagesQuery, id, type CustomerPackagesQuery } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { RequireAny, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  CustomerPackageReadError,
  CustomerPackagesQueryHandler,
} from '../queries/customer-packages.query.ts';
import { CustomerPackageDetailQueryHandler } from '../queries/package-entitlement-detail.query.ts';

@Controller('businesses/:businessId/branches/:branchId/customers/:customerId/packages')
export class CustomerPackagesController {
  constructor(
    @Inject(CustomerPackagesQueryHandler) private readonly packages: CustomerPackagesQueryHandler | null,
    @Inject(CustomerPackageDetailQueryHandler) private readonly detail: CustomerPackageDetailQueryHandler | null,
  ) {}

  @Get('')
  @RequireAny(['record:service-sessions:branch', 'read:service-sessions:branch'], { branch: 'branchId' })
  @RequiresFeature('orders')
  async list(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('branchId', new ZodValidationPipe(id.toLowerCase())) branchId: string,
    @Param('customerId', new ZodValidationPipe(id.toLowerCase())) customerId: string,
    @Query(new ZodValidationPipe(customerPackagesQuery)) query: CustomerPackagesQuery,
    @Req() request: FastifyRequest,
  ) {
    if (this.packages === null) throw new ApiError('NOT_READY');
    try {
      return await this.packages.execute({ ...actorOf(request), businessId, branchId, customerId }, query);
    } catch (error) {
      if (error instanceof RangeError && error.message === 'CUSTOMER_PACKAGES_CURSOR_INVALID') {
        throw new ApiError('VALIDATION_FAILED');
      }
      if (error instanceof CustomerPackageReadError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Get(':entitlementId')
  @RequireAny(['record:service-sessions:branch', 'read:service-sessions:branch'], { branch: 'branchId' })
  @RequiresFeature('orders')
  async read(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('branchId', new ZodValidationPipe(id.toLowerCase())) branchId: string,
    @Param('customerId', new ZodValidationPipe(id.toLowerCase())) customerId: string,
    @Param('entitlementId', new ZodValidationPipe(id.toLowerCase())) entitlementId: string,
    @Req() request: FastifyRequest,
  ) {
    if (this.detail === null) throw new ApiError('NOT_READY');
    try {
      return await this.detail.execute({ ...actorOf(request), businessId, branchId, customerId }, entitlementId);
    } catch (error) {
      if (error instanceof CustomerPackageReadError) throw new ApiError(error.code);
      throw error;
    }
  }
}
