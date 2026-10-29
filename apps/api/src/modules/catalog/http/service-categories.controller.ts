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
  createServiceCategoryInput,
  id,
  renameServiceCategoryInput,
  serviceCategoryListQuery,
  type CreateServiceCategoryInput,
  type RenameServiceCategoryInput,
  type ServiceCategory,
  type ServiceCategoryListQuery,
  type ServiceCategoryPage,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { listServiceCategories } from '../queries/service-categories.query.ts';
import {
  CreateServiceCategoryUseCase,
  ServiceCategoryError,
} from '../use-cases/create-service-category/create-service-category.usecase.ts';
import { RenameServiceCategoryUseCase } from '../use-cases/rename-service-category/rename-service-category.usecase.ts';

@Controller('businesses/:businessId/service-categories')
export class ServiceCategoriesController {
  constructor(
    @Inject(CreateServiceCategoryUseCase)
    private readonly createCategory: CreateServiceCategoryUseCase | null,
    @Inject(RenameServiceCategoryUseCase)
    private readonly renameCategory: RenameServiceCategoryUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
  ) {}

  @Post()
  @HttpCode(201)
  @Require('manage:service-categories:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async create(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new ZodValidationPipe(createServiceCategoryInput)) input: CreateServiceCategoryInput,
    @Req() request: FastifyRequest,
  ): Promise<ServiceCategory> {
    if (this.createCategory === null) throw new ApiError('NOT_READY');
    try {
      return await this.createCategory.execute({ ...actorOf(request), businessId, input });
    } catch (error) {
      if (error instanceof ServiceCategoryError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Get()
  @Require('read:service-categories:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async list(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Query(new ZodValidationPipe(serviceCategoryListQuery)) query: ServiceCategoryListQuery,
    @Req() request: FastifyRequest,
  ): Promise<ServiceCategoryPage> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    return this.database.withTenant(
      actor.companyId,
      (tx) => listServiceCategories(tx, actor.companyId, businessId, query),
      { userId: actor.userId },
    );
  }

  @Patch(':categoryId')
  @Require('manage:service-categories:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async rename(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('categoryId', new ZodValidationPipe(id)) categoryId: string,
    @Body(new ZodValidationPipe(renameServiceCategoryInput)) input: RenameServiceCategoryInput,
    @Req() request: FastifyRequest,
  ): Promise<ServiceCategory> {
    if (this.renameCategory === null) throw new ApiError('NOT_READY');
    try {
      return await this.renameCategory.execute({
        ...actorOf(request),
        businessId,
        categoryId,
        input,
      });
    } catch (error) {
      if (error instanceof ServiceCategoryError) throw new ApiError(error.code);
      throw error;
    }
  }
}
