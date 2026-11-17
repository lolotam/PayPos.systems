import { PackageTypeValidationPipe } from './package-type-validation.pipe.ts';
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
  id,
  packageTypeListQuery,
  packageTypeSellingInput,
  type CreatePackageTypeInput,
  type PackageServiceOptionPage,
  type PackageTypeDetail,
  type PackageTypeListQuery,
  type PackageTypePage,
  type PackageTypeSellingInput,
  type UpdatePackageTypeInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { REQUEST_AUTHORIZER, type RequestAuthorizer } from '../../../shared/request-authorizer.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { listPackageTypes } from '../queries/list-package-types.query.ts';
import { readPackageTypeManageCapability } from '../queries/package-type-capability.query.ts';
import { getPackageTypeDetail } from '../queries/package-type-detail.query.ts';
import { listPackageServiceOptions } from '../queries/package-service-options.query.ts';
import {
  CreatePackageTypeUseCase,
  PackageTypeError,
} from '../use-cases/create-package-type/create-package-type.usecase.ts';
import { ResumeSellingPackageTypeUseCase } from '../use-cases/resume-selling-package-type/resume-selling-package-type.usecase.ts';
import { StopSellingPackageTypeUseCase } from '../use-cases/stop-selling-package-type/stop-selling-package-type.usecase.ts';
import { UpdatePackageTypeUseCase } from '../use-cases/update-package-type/update-package-type.usecase.ts';

@Controller('businesses/:businessId/package-types')
export class PackageTypesController {
  constructor(
    @Inject(CreatePackageTypeUseCase)
    private readonly createPackageType: CreatePackageTypeUseCase | null,
    @Inject(UpdatePackageTypeUseCase)
    private readonly updatePackageType: UpdatePackageTypeUseCase | null,
    @Inject(StopSellingPackageTypeUseCase)
    private readonly stopSellingPackageType: StopSellingPackageTypeUseCase | null,
    @Inject(ResumeSellingPackageTypeUseCase)
    private readonly resumeSellingPackageType: ResumeSellingPackageTypeUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(REQUEST_AUTHORIZER) private readonly authorizer: RequestAuthorizer | null,
  ) {}

  @Post()
  @HttpCode(201)
  @Require('manage:package-types:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async create(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new PackageTypeValidationPipe()) input: CreatePackageTypeInput,
    @Req() request: FastifyRequest,
  ): Promise<PackageTypeDetail> {
    if (this.createPackageType === null) throw new ApiError('NOT_READY');
    try {
      return await this.createPackageType.execute({ ...actorOf(request), businessId, input });
    } catch (error) {
      if (error instanceof PackageTypeError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Get()
  @Require('read:package-types:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async list(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Query(new ZodValidationPipe(packageTypeListQuery)) query: PackageTypeListQuery,
    @Req() request: FastifyRequest,
  ): Promise<PackageTypePage> {
    if (this.database === null || this.authorizer === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const page = await this.database.withTenant(
      actor.companyId,
      (tx) => listPackageTypes(tx, actor.companyId, businessId, query),
      { userId: actor.userId },
    );
    const can_manage = await readPackageTypeManageCapability(this.authorizer, {
      companyId: actor.companyId,
      businessId,
      userId: actor.userId,
    });
    return { ...page, can_manage };
  }

  @Get('service-options')
  @Require('read:package-types:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async serviceOptions(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Query(new ZodValidationPipe(packageTypeListQuery)) query: PackageTypeListQuery,
    @Req() request: FastifyRequest,
  ): Promise<PackageServiceOptionPage> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    return this.database.withTenant(
      actor.companyId,
      (tx) => listPackageServiceOptions(tx, actor.companyId, businessId, query),
      { userId: actor.userId },
    );
  }

  @Get(':packageTypeId')
  @Require('read:package-types:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async detail(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('packageTypeId', new ZodValidationPipe(id)) packageTypeId: string,
    @Req() request: FastifyRequest,
  ): Promise<PackageTypeDetail> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const found = await this.database.withTenant(
      actor.companyId,
      (tx) => getPackageTypeDetail(tx, actor.companyId, businessId, packageTypeId),
      { userId: actor.userId },
    );
    if (found === null) throw new ApiError('PACKAGE_TYPE_NOT_FOUND');
    return found;
  }

  @Patch(':packageTypeId')
  @Require('manage:package-types:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async update(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('packageTypeId', new ZodValidationPipe(id)) packageTypeId: string,
    @Body(new PackageTypeValidationPipe(true)) input: UpdatePackageTypeInput,
    @Req() request: FastifyRequest,
  ): Promise<PackageTypeDetail> {
    if (this.updatePackageType === null) throw new ApiError('NOT_READY');
    try {
      return await this.updatePackageType.execute({
        ...actorOf(request),
        businessId,
        packageTypeId,
        input,
      });
    } catch (error) {
      if (error instanceof PackageTypeError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Post(':packageTypeId/stop-selling')
  @HttpCode(200)
  @Require('manage:package-types:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async stopSelling(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('packageTypeId', new ZodValidationPipe(id)) packageTypeId: string,
    @Body(new ZodValidationPipe(packageTypeSellingInput)) input: PackageTypeSellingInput,
    @Req() request: FastifyRequest,
  ): Promise<PackageTypeDetail> {
    if (this.stopSellingPackageType === null) throw new ApiError('NOT_READY');
    try {
      return await this.stopSellingPackageType.execute({
        ...actorOf(request),
        businessId,
        packageTypeId,
        input,
      });
    } catch (error) {
      if (error instanceof PackageTypeError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Post(':packageTypeId/resume-selling')
  @HttpCode(200)
  @Require('manage:package-types:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async resumeSelling(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('packageTypeId', new ZodValidationPipe(id)) packageTypeId: string,
    @Body(new ZodValidationPipe(packageTypeSellingInput)) input: PackageTypeSellingInput,
    @Req() request: FastifyRequest,
  ): Promise<PackageTypeDetail> {
    if (this.resumeSellingPackageType === null) throw new ApiError('NOT_READY');
    try {
      return await this.resumeSellingPackageType.execute({
        ...actorOf(request),
        businessId,
        packageTypeId,
        input,
      });
    } catch (error) {
      if (error instanceof PackageTypeError) throw new ApiError(error.code);
      throw error;
    }
  }
}
