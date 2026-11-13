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
  closeServiceCategoryInput,
  createServiceCategoryInput,
  id,
  renameServiceCategoryInput,
  reopenServiceCategoryInput,
  serviceCategoryListQuery,
  type CloseServiceCategoryInput,
  type CloseServiceCategoryResult,
  type CreateServiceCategoryInput,
  type RenameServiceCategoryInput,
  type ReopenServiceCategoryInput,
  type ReopenServiceCategoryResult,
  type ServiceCategory,
  type ServiceCategoryDetail,
  type ServiceCategoryListQuery,
  type ServiceCategoryPage,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require, RequireAll, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { serviceCategoryDetail } from '../queries/service-category-detail.query.ts';
import { listServiceCategories } from '../queries/service-categories.query.ts';
import { CloseServiceCategoryUseCase } from '../use-cases/close-service-category/close-service-category.usecase.ts';
import {
  CreateServiceCategoryUseCase,
  ServiceCategoryError,
} from '../use-cases/create-service-category/create-service-category.usecase.ts';
import { RenameServiceCategoryUseCase } from '../use-cases/rename-service-category/rename-service-category.usecase.ts';
import { ReopenServiceCategoryUseCase } from '../use-cases/reopen-service-category/reopen-service-category.usecase.ts';
import { ServiceCategoryValidationPipe } from './service-category-validation.pipe.ts';

@Controller('businesses/:businessId/service-categories')
export class ServiceCategoriesController {
  constructor(
    @Inject(CreateServiceCategoryUseCase)
    private readonly createCategory: CreateServiceCategoryUseCase | null,
    @Inject(RenameServiceCategoryUseCase)
    private readonly renameCategory: RenameServiceCategoryUseCase | null,
    @Inject(CloseServiceCategoryUseCase)
    private readonly closeCategory: CloseServiceCategoryUseCase | null,
    @Inject(ReopenServiceCategoryUseCase)
    private readonly reopenCategory: ReopenServiceCategoryUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
  ) {}

  @Post()
  @HttpCode(201)
  @Require('manage:service-categories:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async create(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new ServiceCategoryValidationPipe(createServiceCategoryInput))
    input: CreateServiceCategoryInput,
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

  @Get(':categoryId')
  @Require('read:service-categories:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async detail(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('categoryId', new ZodValidationPipe(id)) categoryId: string,
    @Req() request: FastifyRequest,
  ): Promise<ServiceCategoryDetail> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const found = await this.database.withTenant(
      actor.companyId,
      (tx) => serviceCategoryDetail(tx, actor.companyId, businessId, categoryId),
      { userId: actor.userId },
    );
    if (found === null) throw new ApiError('SERVICE_CATEGORY_NOT_FOUND');
    return found;
  }

  @Patch(':categoryId')
  @Require('manage:service-categories:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async rename(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('categoryId', new ZodValidationPipe(id)) categoryId: string,
    @Body(new ServiceCategoryValidationPipe(renameServiceCategoryInput))
    input: RenameServiceCategoryInput,
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

  @Post(':categoryId/close')
  @HttpCode(200)
  @RequireAll(['manage:service-categories:business', 'read:service-categories:business'], {
    business: 'businessId',
  })
  @RequiresFeature('catalog')
  async close(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('categoryId', new ZodValidationPipe(id)) categoryId: string,
    @Body(new ServiceCategoryValidationPipe(closeServiceCategoryInput))
    input: CloseServiceCategoryInput,
    @Req() request: FastifyRequest,
  ): Promise<CloseServiceCategoryResult> {
    if (this.closeCategory === null) throw new ApiError('NOT_READY');
    try {
      return await this.closeCategory.execute({
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

  @Post(':categoryId/reopen')
  @HttpCode(200)
  @RequireAll(['manage:service-categories:business', 'read:service-categories:business'], {
    business: 'businessId',
  })
  @RequiresFeature('catalog')
  async reopen(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('categoryId', new ZodValidationPipe(id)) categoryId: string,
    @Body(new ServiceCategoryValidationPipe(reopenServiceCategoryInput))
    input: ReopenServiceCategoryInput,
    @Req() request: FastifyRequest,
  ): Promise<ReopenServiceCategoryResult> {
    if (this.reopenCategory === null) throw new ApiError('NOT_READY');
    try {
      return await this.reopenCategory.execute({
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
