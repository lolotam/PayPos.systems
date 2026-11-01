import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import {
  id,
  type Customer,
  type FindOrCreateCustomerInput,
  type FindOrCreateScopedCustomerInput,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  FindOrCreateCustomerUseCase,
  InvalidCustomerPhoneError,
  InvalidCustomerProfileError,
  type FindOrCreateCustomerBody,
} from '../use-cases/find-or-create-customer/find-or-create-customer.usecase.ts';
import { CustomerInputPipe, ScopedCustomerInputPipe } from './customer-input.pipe.ts';

@Controller()
export class CustomersController {
  constructor(
    @Inject(FindOrCreateCustomerUseCase)
    private readonly findOrCreate: FindOrCreateCustomerUseCase | null,
  ) {}

  @Post('customers/find-or-create')
  @HttpCode(200)
  @Require('create:customers:company')
  @RequiresFeature('customers')
  async find(
    @Body(new CustomerInputPipe()) input: FindOrCreateCustomerInput,
    @Req() request: FastifyRequest,
  ): Promise<Customer> {
    return this.run({ scope: { kind: 'company' }, input }, request);
  }

  @Post('businesses/:businessId/customers/find-or-create')
  @HttpCode(200)
  @Require('create:customers:business', { business: 'businessId' })
  @RequiresFeature('customers')
  async findInBusiness(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new ScopedCustomerInputPipe()) input: FindOrCreateScopedCustomerInput,
    @Req() request: FastifyRequest,
  ): Promise<Customer> {
    return this.run({ scope: { kind: 'business', businessId }, input }, request);
  }

  @Post('branches/:branchId/customers/find-or-create')
  @HttpCode(200)
  @Require('create:customers:branch', { branch: 'branchId' })
  @RequiresFeature('customers')
  async findInBranch(
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Body(new ScopedCustomerInputPipe()) input: FindOrCreateScopedCustomerInput,
    @Req() request: FastifyRequest,
  ): Promise<Customer> {
    return this.run({ scope: { kind: 'branch', branchId }, input }, request);
  }

  // المسار بيحدد مين الملاحظة تتحفظ تحته بس؛ الرفضات كلها VALIDATION_FAILED من غير أي قيمة (D-10).
  private async run(command: FindOrCreateCustomerBody, request: FastifyRequest): Promise<Customer> {
    if (this.findOrCreate === null) throw new ApiError('NOT_READY');
    try {
      return await this.findOrCreate.execute({ ...actorOf(request), ...command });
    } catch (error) {
      if (error instanceof InvalidCustomerPhoneError) throw new ApiError('INVALID_CUSTOMER_PHONE');
      if (error instanceof InvalidCustomerProfileError) throw new ApiError('VALIDATION_FAILED');
      throw error;
    }
  }
}
