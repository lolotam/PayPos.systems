import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  createServiceInput,
  id,
  serviceListQuery,
  updateServiceInput,
  type CreateServiceInput,
  type Service,
  type ServiceListQuery,
  type ServicePage,
  type UpdateServiceInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { listServices } from '../queries/list-services.query.ts';
import { serviceDetail } from '../queries/service-detail.query.ts';
import {
  CreateServiceUseCase,
  ServiceError,
} from '../use-cases/create-service/create-service.usecase.ts';
import { UpdateServiceUseCase } from '../use-cases/update-service/update-service.usecase.ts';

@Controller('businesses/:businessId/services')
export class ServicesController {
  constructor(
    @Inject(CreateServiceUseCase) private readonly createService: CreateServiceUseCase | null,
    @Inject(UpdateServiceUseCase) private readonly updateService: UpdateServiceUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
  ) {}

  @Post()
  @HttpCode(201)
  @Require('manage:services:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async create(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new ZodValidationPipe(createServiceInput)) input: CreateServiceInput,
    @Req() request: FastifyRequest,
  ): Promise<Service> {
    if (this.createService === null) throw new ApiError('NOT_READY');
    try {
      return await this.createService.execute({ ...actorOf(request), businessId, input });
    } catch (error) {
      if (error instanceof ServiceError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Get()
  @Require('read:services:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async list(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Query(new ZodValidationPipe(serviceListQuery)) query: ServiceListQuery,
    @Req() request: FastifyRequest,
  ): Promise<ServicePage> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    return this.database.withTenant(
      actor.companyId,
      (tx) => listServices(tx, actor.companyId, businessId, query),
      { userId: actor.userId },
    );
  }

  @Get(':serviceId')
  @Require('read:services:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async detail(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('serviceId', new ZodValidationPipe(id)) serviceId: string,
    @Req() request: FastifyRequest,
  ): Promise<Service> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const found = await this.database.withTenant(
      actor.companyId,
      (tx) => serviceDetail(tx, actor.companyId, businessId, serviceId),
      { userId: actor.userId },
    );
    if (found === null) throw new ApiError('SERVICE_NOT_FOUND');
    return found;
  }

  @Patch(':serviceId')
  @Require('manage:services:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async update(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('serviceId', new ZodValidationPipe(id)) serviceId: string,
    @Body(new ZodValidationPipe(updateServiceInput)) input: UpdateServiceInput,
    @Req() request: FastifyRequest,
  ): Promise<Service> {
    if (this.updateService === null) throw new ApiError('NOT_READY');
    try {
      return await this.updateService.execute({
        ...actorOf(request),
        businessId,
        serviceId,
        input,
      });
    } catch (error) {
      if (error instanceof ServiceError) throw new ApiError(error.code);
      throw error;
    }
  }
}
