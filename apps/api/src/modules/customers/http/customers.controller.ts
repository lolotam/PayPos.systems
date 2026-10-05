import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { Customer, FindOrCreateCustomerInput } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import {
  FindOrCreateCustomerUseCase,
  InvalidCustomerPhoneError,
} from '../use-cases/find-or-create-customer/find-or-create-customer.usecase.ts';
import { CustomerInputPipe } from './customer-input.pipe.ts';

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
    if (this.findOrCreate === null) throw new ApiError('NOT_READY');
    try {
      return await this.findOrCreate.execute({ ...actorOf(request), input });
    } catch (error) {
      if (error instanceof InvalidCustomerPhoneError) throw new ApiError('INVALID_CUSTOMER_PHONE');
      throw error;
    }
  }

  @Post('businesses/:businessId/customers/find-or-create')
  @HttpCode(200)
  @Require('create:customers:business', { business: 'businessId' })
  @RequiresFeature('customers')
  async findInBusiness(
    @Body(new CustomerInputPipe()) input: FindOrCreateCustomerInput,
    @Req() request: FastifyRequest,
  ): Promise<Customer> {
    return this.find(input, request);
  }

  @Post('branches/:branchId/customers/find-or-create')
  @HttpCode(200)
  @Require('create:customers:branch', { branch: 'branchId' })
  @RequiresFeature('customers')
  async findInBranch(
    @Body(new CustomerInputPipe()) input: FindOrCreateCustomerInput,
    @Req() request: FastifyRequest,
  ): Promise<Customer> {
    return this.find(input, request);
  }
}
