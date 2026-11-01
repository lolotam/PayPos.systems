import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import { id, type CustomerProfile } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  CUSTOMER_PROFILE_CONTEXT,
  CustomerProfileReadError,
  readCustomerProfile,
  type CustomerProfileContext,
} from '../queries/customer-profile.query.ts';

@Controller()
export class CustomerProfileController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(CUSTOMER_PROFILE_CONTEXT) private readonly context: CustomerProfileContext,
  ) {}

  @Get('customers/:customerId/profile')
  @Require('create:customers:company')
  @RequiresFeature('customers')
  async profile(
    @Param('customerId', new ZodValidationPipe(id)) customerId: string,
    @Req() request: FastifyRequest,
  ): Promise<CustomerProfile> {
    return this.read(customerId, request);
  }

  @Get('businesses/:businessId/customers/:customerId/profile')
  @Require('create:customers:business', { business: 'businessId' })
  @RequiresFeature('customers')
  async profileInBusiness(
    @Param('customerId', new ZodValidationPipe(id)) customerId: string,
    @Req() request: FastifyRequest,
  ): Promise<CustomerProfile> {
    return this.read(customerId, request);
  }

  @Get('branches/:branchId/customers/:customerId/profile')
  @Require('create:customers:branch', { branch: 'branchId' })
  @RequiresFeature('customers')
  async profileInBranch(
    @Param('customerId', new ZodValidationPipe(id)) customerId: string,
    @Req() request: FastifyRequest,
  ): Promise<CustomerProfile> {
    return this.read(customerId, request);
  }

  // النطاق بيأمن الدخول بس؛ ملاحظات كل أنشطة الشركة بتظهر لكل نطاق (CI-Q17).
  private async read(customerId: string, request: FastifyRequest): Promise<CustomerProfile> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    try {
      // معاملة واحدة للبطاقة والملاحظات وأسماء الأنشطة؛ مفيش معاملة جوه معاملة.
      const profile = await this.database.withTenant(
        actor.companyId,
        async (tx) => readCustomerProfile(tx, actor.companyId, customerId, this.context),
        { userId: actor.userId },
      );
      if (profile === null) throw new ApiError('NOT_FOUND');
      return profile;
    } catch (error) {
      // حد القراءة بينضّف أي خطأ تاني: خطأ السائق بيطلع SQL ورقم العميل في سجل الفلتر.
      if (error instanceof ApiError) throw error;
      if (error instanceof CustomerProfileReadError) throw error;
      throw new CustomerProfileReadError();
    }
  }
}
