import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  commitServiceImportInput,
  id,
  previewServiceImportInput,
  serviceImportRowsQuery,
  type CommitServiceImportInput,
  type PreviewServiceImportInput,
  type ServiceImportCommitAccepted,
  type ServiceImportPreview,
  type ServiceImportRowsPage,
  type ServiceImportRowsQuery,
  type ServiceImportStatus,
  type ServiceImportTemplate,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { serviceImportRowsPage } from '../queries/service-import-rows.query.ts';
import { serviceImportStatusQuery } from '../queries/service-import-status.query.ts';
import { ServiceImportError } from '../use-cases/preview-service-import/preview-service-import.usecase.ts';
import { CommitServiceImportUseCase } from '../use-cases/commit-service-import/commit-service-import.usecase.ts';
import { GetServiceImportTemplateUseCase } from '../use-cases/get-service-import-template/get-service-import-template.usecase.ts';
import { PreviewServiceImportUseCase } from '../use-cases/preview-service-import/preview-service-import.usecase.ts';

// المسار الثابت `import` أُعلن هنا قبل مسارات الخدمات ذات المعرّف، فلا يبتلعها route الخدمة الواحدة (FR-003).
@Controller('businesses/:businessId/services/import')
export class ServiceImportController {
  constructor(
    @Inject(GetServiceImportTemplateUseCase)
    private readonly template: GetServiceImportTemplateUseCase | null,
    @Inject(PreviewServiceImportUseCase)
    private readonly preview: PreviewServiceImportUseCase | null,
    @Inject(CommitServiceImportUseCase)
    private readonly commit: CommitServiceImportUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
  ) {}

  @Get('template')
  @Require('manage:services:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async download(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Req() request: FastifyRequest,
  ): Promise<ServiceImportTemplate> {
    if (this.template === null) throw new ApiError('NOT_READY');
    try {
      return await this.template.execute({ ...actorOf(request), businessId });
    } catch (error) {
      if (error instanceof ServiceImportError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Post('previews')
  @HttpCode(201)
  @Require('manage:services:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async createPreview(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new ZodValidationPipe(previewServiceImportInput)) input: PreviewServiceImportInput,
    @Req() request: FastifyRequest,
  ): Promise<ServiceImportPreview> {
    if (this.preview === null) throw new ApiError('STORAGE_NOT_CONFIGURED');
    try {
      return await this.preview.execute({
        ...actorOf(request),
        businessId,
        fileId: input.file_id,
      });
    } catch (error) {
      if (error instanceof ServiceImportError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Get('previews/:previewId/rows')
  @Require('manage:services:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async rows(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('previewId', new ZodValidationPipe(id)) previewId: string,
    @Query(new ZodValidationPipe(serviceImportRowsQuery)) query: ServiceImportRowsQuery,
    @Req() request: FastifyRequest,
  ): Promise<ServiceImportRowsPage> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    return serviceImportRowsPage(
      this.database,
      actor.companyId,
      actor.userId,
      businessId,
      previewId,
      query.cursor,
      query.limit,
    );
  }

  @Get('previews/:previewId')
  @Require('manage:services:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async status(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('previewId', new ZodValidationPipe(id)) previewId: string,
    @Req() request: FastifyRequest,
  ): Promise<ServiceImportStatus> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    return serviceImportStatusQuery(
      this.database,
      actor.companyId,
      actor.userId,
      businessId,
      previewId,
    );
  }

  @Post('commits')
  @HttpCode(202)
  @Require('manage:services:business', { business: 'businessId' })
  @RequiresFeature('catalog')
  async createCommit(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new ZodValidationPipe(commitServiceImportInput)) input: CommitServiceImportInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ): Promise<ServiceImportCommitAccepted> {
    if (this.commit === null) throw new ApiError('NOT_READY');
    try {
      return await this.commit.execute({
        ...actorOf(request),
        businessId,
        previewId: input.preview_id,
        ...idem,
      });
    } catch (error) {
      if (error instanceof ServiceImportError) throw new ApiError(error.code);
      throw error;
    }
  }
}
