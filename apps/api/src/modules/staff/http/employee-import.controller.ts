import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  commitEmployeeImportInput,
  id,
  previewEmployeeImportInput,
  type CommitEmployeeImportInput,
  type PreviewEmployeeImportInput,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { EmployeeImportError } from '../use-cases/preview-employee-import/preview-employee-import.usecase.ts';
import { CommitEmployeeImportUseCase } from '../use-cases/commit-employee-import/commit-employee-import.usecase.ts';
import { GetEmployeeImportTemplateUseCase } from '../use-cases/get-employee-import-template/get-employee-import-template.usecase.ts';
import { PreviewEmployeeImportUseCase } from '../use-cases/preview-employee-import/preview-employee-import.usecase.ts';

@Controller('businesses/:businessId/employees/import')
export class EmployeeImportController {
  constructor(
    @Inject(GetEmployeeImportTemplateUseCase)
    private readonly template: GetEmployeeImportTemplateUseCase | null,
    @Inject(PreviewEmployeeImportUseCase)
    private readonly preview: PreviewEmployeeImportUseCase | null,
    @Inject(CommitEmployeeImportUseCase)
    private readonly commit: CommitEmployeeImportUseCase | null,
  ) {}

  @Get('template')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async download(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Req() request: FastifyRequest,
  ) {
    if (this.template === null) throw new ApiError('NOT_READY');
    try {
      return await this.template.execute({ ...actorOf(request), businessId });
    } catch (error) {
      if (error instanceof EmployeeImportError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Post('previews')
  @HttpCode(201)
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async createPreview(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new ZodValidationPipe(previewEmployeeImportInput)) input: PreviewEmployeeImportInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.preview === null) throw new ApiError('STORAGE_NOT_CONFIGURED');
    try {
      return await this.preview.execute({ ...actorOf(request), businessId, fileId: input.file_id });
    } catch (error) {
      if (error instanceof EmployeeImportError) throw new ApiError(error.code);
      throw error;
    }
  }

  @Post('commits')
  @HttpCode(201)
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async createCommit(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Body(new ZodValidationPipe(commitEmployeeImportInput)) input: CommitEmployeeImportInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.commit === null) throw new ApiError('NOT_READY');
    try {
      return await this.commit.execute({
        ...actorOf(request),
        businessId,
        previewId: input.preview_id,
        ...idem,
      });
    } catch (error) {
      if (error instanceof EmployeeImportError) throw new ApiError(error.code);
      throw error;
    }
  }
}
