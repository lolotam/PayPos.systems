import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  createBranchServiceCategoryInput,
  id,
  renameServiceCategoryInput,
  serviceCategoryBranchListQuery,
  setServiceCategoryBranchStateInput,
  type CreateBranchServiceCategoryInput,
  type RenameServiceCategoryInput,
  type ServiceCategory,
  type ServiceCategoryBranchListQuery,
  type ServiceCategoryBranchPage,
  type ServiceCategoryBranchStateResult,
  type SetServiceCategoryBranchStateInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { listBranchServiceCategories } from '../queries/branch-service-categories.query.ts';
import { SetServiceCategoryBranchStateUseCase } from '../use-cases/set-service-category-branch-state/set-service-category-branch-state.usecase.ts';
import { ServiceCategoryValidationPipe } from './service-category-validation.pipe.ts';
import {
  CreateServiceCategoryUseCase,
  ServiceCategoryError,
} from '../use-cases/create-service-category/create-service-category.usecase.ts';
import { RenameServiceCategoryUseCase } from '../use-cases/rename-service-category/rename-service-category.usecase.ts';

@Controller('businesses/:businessId/branches/:branchId/service-categories')
export class BranchServiceCategoriesController {
  constructor(
    @Inject(CreateServiceCategoryUseCase)
    private readonly createCategory: CreateServiceCategoryUseCase | null,
    @Inject(RenameServiceCategoryUseCase)
    private readonly renameCategory: RenameServiceCategoryUseCase | null,
    @Inject(SetServiceCategoryBranchStateUseCase)
    private readonly setState: SetServiceCategoryBranchStateUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
  ) {}

  @Get()
  @Require('read:service-categories:branch', { branch: 'branchId' })
  @RequiresFeature('catalog')
  async list(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Query(new ZodValidationPipe(serviceCategoryBranchListQuery))
    query: ServiceCategoryBranchListQuery,
    @Req() request: FastifyRequest,
  ): Promise<ServiceCategoryBranchPage> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    try {
      return await this.database.withTenant(
        actor.companyId,
        (tx) => listBranchServiceCategories(tx, actor.companyId, businessId, branchId, query),
        { userId: actor.userId },
      );
    } catch (error) {
      if (error instanceof RangeError && error.message === 'SERVICE_CATEGORY_CURSOR_INVALID')
        throw new ApiError('VALIDATION_FAILED');
      if (error instanceof RangeError && error.message === 'SERVICE_CATEGORY_NOT_FOUND')
        throw new ApiError('SERVICE_CATEGORY_NOT_FOUND');
      throw error;
    }
  }

  @Post()
  @HttpCode(201)
  @Require('manage:service-categories:branch', { branch: 'branchId' })
  @RequiresFeature('catalog')
  async create(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Body(new ServiceCategoryValidationPipe(createBranchServiceCategoryInput))
    input: CreateBranchServiceCategoryInput,
    @Req() request: FastifyRequest,
  ): Promise<ServiceCategory> {
    if (this.createCategory === null) throw new ApiError('NOT_READY');
    try {
      return await this.createCategory.execute({
        ...actorOf(request),
        businessId,
        branchId,
        input,
      });
    } catch (error) {
      if (error instanceof ServiceCategoryError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Patch(':categoryId')
  @Require('manage:service-categories:branch', { branch: 'branchId' })
  @RequiresFeature('catalog')
  async rename(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
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
        branchId,
        categoryId,
        input,
      });
    } catch (error) {
      if (error instanceof ServiceCategoryError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Put(':categoryId/state')
  @Require('manage:service-categories:branch', { branch: 'branchId' })
  @RequiresFeature('catalog')
  async setBranchState(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Param('categoryId', new ZodValidationPipe(id)) categoryId: string,
    @Body(new ZodValidationPipe(setServiceCategoryBranchStateInput))
    input: SetServiceCategoryBranchStateInput,
    @Req() request: FastifyRequest,
  ): Promise<ServiceCategoryBranchStateResult> {
    if (this.setState === null) throw new ApiError('NOT_READY');
    try {
      return await this.setState.execute({
        ...actorOf(request),
        businessId,
        branchId,
        categoryId,
        input,
      });
    } catch (error) {
      if (error instanceof ServiceCategoryError) throw new ApiError(error.code);
      throw error;
    }
  }
}
