import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  createBranchServiceCategoryInput,
  id,
  renameServiceCategoryInput,
  type CreateBranchServiceCategoryInput,
  type RenameServiceCategoryInput,
  type ServiceCategory,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
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
  ) {}

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
}
