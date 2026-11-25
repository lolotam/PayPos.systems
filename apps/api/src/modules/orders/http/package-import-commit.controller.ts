import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import {
  commitPackageImportInput,
  id,
  type CommitPackageImportInput,
  type PackageImportCommitAccepted,
  type PackageImportTemplate,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { PackageImportRequestError } from '../use-cases/request-package-import-preview/request-package-import-preview.usecase.ts';
import {
  CommitPackageImportUseCase,
  PackageImportCommitError,
} from '../use-cases/commit-package-import/commit-package-import.usecase.ts';
import {
  GetPackageImportTemplateUseCase,
  PackageImportTemplateError,
} from '../use-cases/get-package-import-template/get-package-import-template.usecase.ts';

// 47-2d: المسارات الثابتة template وcommits تحت نفس بادئة المعاينة، فلا تتصادم مع :previewId (مختلف الجذر).
@Controller('businesses/:businessId/packages/import')
export class PackageImportCommitController {
  constructor(
    @Inject(GetPackageImportTemplateUseCase)
    private readonly getTemplate: GetPackageImportTemplateUseCase | null,
    @Inject(CommitPackageImportUseCase)
    private readonly commitImport: CommitPackageImportUseCase | null,
  ) {}

  @Get('template')
  @Require('import:packages:business', { business: 'businessId' })
  @RequiresFeature('orders')
  async template(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Req() request: FastifyRequest,
  ): Promise<PackageImportTemplate> {
    if (this.getTemplate === null) throw new ApiError('NOT_READY');
    try {
      return await this.getTemplate.execute({ ...actorOf(request), businessId });
    } catch (error) {
      if (error instanceof PackageImportTemplateError || error instanceof PackageImportRequestError)
        throw new ApiError(error.code);
      throw error;
    }
  }

  @Post('commits')
  @HttpCode(202)
  @Require('import:packages:business', { business: 'businessId' })
  @RequiresFeature('orders')
  async commit(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Body(new ZodValidationPipe(commitPackageImportInput)) input: CommitPackageImportInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ): Promise<PackageImportCommitAccepted> {
    if (this.commitImport === null) throw new ApiError('NOT_READY');
    try {
      return await this.commitImport.execute({
        ...actorOf(request),
        businessId,
        previewId: input.preview_id.toLowerCase(),
        ...idem,
      });
    } catch (error) {
      if (error instanceof PackageImportCommitError) throw new ApiError(error.code);
      throw error;
    }
  }
}
