import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  id,
  requestPackageImportPreviewInput,
  type RequestPackageImportPreviewInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { DATABASE } from '../../../shared/database.token.ts';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { packageImportPreviewStatusQuery } from '../queries/package-import-preview-status.query.ts';
import {
  RequestPackageImportPreviewUseCase,
  PackageImportRequestError,
} from '../use-cases/request-package-import-preview/request-package-import-preview.usecase.ts';

// 47-1a: هذا المتحكم غير مسجل في ordersControllers؛ تفعيله مع المستهلك في 47-1b فقط.
@Controller('businesses/:businessId/packages/import/previews')
export class PackageImportPreviewController {
  constructor(
    @Inject(RequestPackageImportPreviewUseCase)
    private readonly requestPreview: RequestPackageImportPreviewUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
  ) {}

  @Post()
  @HttpCode(202)
  @Require('import:packages:business', { business: 'businessId' })
  @RequiresFeature('orders')
  async request(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new ZodValidationPipe(requestPackageImportPreviewInput))
    input: RequestPackageImportPreviewInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.requestPreview === null) throw new ApiError('NOT_READY');
    try {
      return await this.requestPreview.execute({
        ...actorOf(request),
        businessId,
        fileId: input.file_id,
      });
    } catch (error) {
      if (error instanceof PackageImportRequestError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Get(':previewId')
  @Require('import:packages:business', { business: 'businessId' })
  @RequiresFeature('orders')
  status(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('previewId', new ZodValidationPipe(id)) previewId: string,
    @Req() request: FastifyRequest,
  ) {
    if (this.database === null) throw new ApiError('NOT_READY');
    return packageImportPreviewStatusQuery(this.database, {
      ...actorOf(request),
      businessId,
      previewId,
    });
  }
}
