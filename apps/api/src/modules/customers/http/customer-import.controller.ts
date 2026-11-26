import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  commitCustomerImportInput,
  customerImportRowsQuery,
  id,
  previewCustomerImportInput,
  type CommitCustomerImportInput,
  type CustomerImportCommitAccepted,
  type CustomerImportPreview,
  type CustomerImportRowsPage,
  type CustomerImportRowsQuery,
  type CustomerImportStatus,
  type CustomerImportTemplate,
  type PreviewCustomerImportInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  CUSTOMER_IMPORT_SCOPE_READS,
  customerImportRowsPage,
  customerImportStatusQuery,
  type CustomerImportScopeReads,
} from '../queries/customer-import-reads.query.ts';
import {
  CommitCustomerImportUseCase,
  CustomerImportError,
  GetCustomerImportTemplateUseCase,
  PreviewCustomerImportUseCase,
  type CustomerImportScope,
} from '../use-cases/customer-import/customer-import.usecases.ts';

const ID_PIPE = new ZodValidationPipe(id);
const PREVIEW_PIPE = new ZodValidationPipe(previewCustomerImportInput);
const ROWS_PIPE = new ZodValidationPipe(customerImportRowsQuery);
const COMMIT_PIPE = new ZodValidationPipe(commitCustomerImportInput);

class ImportHandlers {
  constructor(
    private readonly template: GetCustomerImportTemplateUseCase | null,
    private readonly preview: PreviewCustomerImportUseCase | null,
    private readonly commit: CommitCustomerImportUseCase | null,
    private readonly db: TenantWrappers | null,
    private readonly reads: CustomerImportScopeReads | null,
  ) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof CustomerImportError) throw new ApiError(error.code);
      throw error;
    }
  }

  download(req: FastifyRequest, scope: CustomerImportScope): Promise<CustomerImportTemplate> {
    const useCase = this.template;
    if (useCase === null) throw new ApiError('NOT_READY');
    return this.run(() => useCase.execute({ ...actorOf(req), scope }));
  }

  createPreview(
    req: FastifyRequest,
    scope: CustomerImportScope,
    input: PreviewCustomerImportInput,
  ): Promise<CustomerImportPreview> {
    const useCase = this.preview;
    if (useCase === null) throw new ApiError('STORAGE_NOT_CONFIGURED');
    return this.run(() => useCase.execute({ ...actorOf(req), scope, fileId: input.file_id }));
  }

  rows(
    req: FastifyRequest,
    scope: CustomerImportScope,
    previewId: string,
    query: CustomerImportRowsQuery,
  ): Promise<CustomerImportRowsPage> {
    const { db, reads } = this;
    if (db === null || reads === null) throw new ApiError('NOT_READY');
    return this.run(() =>
      customerImportRowsPage(db, reads, {
        ...actorOf(req),
        scope,
        previewId,
        cursor: query.cursor,
        limit: query.limit,
      }),
    );
  }

  status(
    req: FastifyRequest,
    scope: CustomerImportScope,
    previewId: string,
  ): Promise<CustomerImportStatus> {
    const { db, reads } = this;
    if (db === null || reads === null) throw new ApiError('NOT_READY');
    return this.run(() =>
      customerImportStatusQuery(db, reads, { ...actorOf(req), scope, previewId }),
    );
  }

  createCommit(
    req: FastifyRequest,
    scope: CustomerImportScope,
    input: CommitCustomerImportInput,
    idem: IdempotencyInput,
  ): Promise<CustomerImportCommitAccepted> {
    const useCase = this.commit;
    if (useCase === null) throw new ApiError('NOT_READY');
    return this.run(() =>
      useCase.execute({ ...actorOf(req), scope, previewId: input.preview_id, ...idem }),
    );
  }
}

// المسار الثابت `import` أُعلن قبل مسارات العملاء ذات المعرّف حتى لا يبتلعه route العميل (073 FR-003).
@Controller('businesses/:businessId/customers/import')
export class BusinessCustomerImportController {
  private readonly h: ImportHandlers;

  constructor(
    @Inject(GetCustomerImportTemplateUseCase) template: GetCustomerImportTemplateUseCase | null,
    @Inject(PreviewCustomerImportUseCase) preview: PreviewCustomerImportUseCase | null,
    @Inject(CommitCustomerImportUseCase) commit: CommitCustomerImportUseCase | null,
    @Inject(DATABASE) db: TenantWrappers | null,
    @Inject(CUSTOMER_IMPORT_SCOPE_READS) reads: CustomerImportScopeReads | null,
  ) {
    this.h = new ImportHandlers(template, preview, commit, db, reads);
  }

  @Get('template')
  @Require('create:customers:business', { business: 'businessId' })
  @RequiresFeature('customers')
  download(@Param('businessId', ID_PIPE) businessId: string, @Req() req: FastifyRequest) {
    return this.h.download(req, { kind: 'business', id: businessId });
  }

  @Post('previews')
  @HttpCode(201)
  @Require('create:customers:business', { business: 'businessId' })
  @RequiresFeature('customers')
  createPreview(
    @Param('businessId', ID_PIPE) businessId: string,
    @Body(PREVIEW_PIPE) input: PreviewCustomerImportInput,
    @Req() req: FastifyRequest,
  ) {
    return this.h.createPreview(req, { kind: 'business', id: businessId }, input);
  }

  @Get('previews/:previewId/rows')
  @Require('create:customers:business', { business: 'businessId' })
  @RequiresFeature('customers')
  rows(
    @Param('businessId', ID_PIPE) businessId: string,
    @Param('previewId', ID_PIPE) previewId: string,
    @Query(ROWS_PIPE) query: CustomerImportRowsQuery,
    @Req() req: FastifyRequest,
  ) {
    return this.h.rows(req, { kind: 'business', id: businessId }, previewId, query);
  }

  @Get('previews/:previewId')
  @Require('create:customers:business', { business: 'businessId' })
  @RequiresFeature('customers')
  status(
    @Param('businessId', ID_PIPE) businessId: string,
    @Param('previewId', ID_PIPE) previewId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.h.status(req, { kind: 'business', id: businessId }, previewId);
  }

  @Post('commits')
  @HttpCode(202)
  @Require('create:customers:business', { business: 'businessId' })
  @RequiresFeature('customers')
  createCommit(
    @Param('businessId', ID_PIPE) businessId: string,
    @Body(COMMIT_PIPE) input: CommitCustomerImportInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() req: FastifyRequest,
  ) {
    return this.h.createCommit(req, { kind: 'business', id: businessId }, input, idem);
  }
}

@Controller('branches/:branchId/customers/import')
export class BranchCustomerImportController {
  private readonly h: ImportHandlers;

  constructor(
    @Inject(GetCustomerImportTemplateUseCase) template: GetCustomerImportTemplateUseCase | null,
    @Inject(PreviewCustomerImportUseCase) preview: PreviewCustomerImportUseCase | null,
    @Inject(CommitCustomerImportUseCase) commit: CommitCustomerImportUseCase | null,
    @Inject(DATABASE) db: TenantWrappers | null,
    @Inject(CUSTOMER_IMPORT_SCOPE_READS) reads: CustomerImportScopeReads | null,
  ) {
    this.h = new ImportHandlers(template, preview, commit, db, reads);
  }

  @Get('template')
  @Require('create:customers:branch', { branch: 'branchId' })
  @RequiresFeature('customers')
  download(@Param('branchId', ID_PIPE) branchId: string, @Req() req: FastifyRequest) {
    return this.h.download(req, { kind: 'branch', id: branchId });
  }

  @Post('previews')
  @HttpCode(201)
  @Require('create:customers:branch', { branch: 'branchId' })
  @RequiresFeature('customers')
  createPreview(
    @Param('branchId', ID_PIPE) branchId: string,
    @Body(PREVIEW_PIPE) input: PreviewCustomerImportInput,
    @Req() req: FastifyRequest,
  ) {
    return this.h.createPreview(req, { kind: 'branch', id: branchId }, input);
  }

  @Get('previews/:previewId/rows')
  @Require('create:customers:branch', { branch: 'branchId' })
  @RequiresFeature('customers')
  rows(
    @Param('branchId', ID_PIPE) branchId: string,
    @Param('previewId', ID_PIPE) previewId: string,
    @Query(ROWS_PIPE) query: CustomerImportRowsQuery,
    @Req() req: FastifyRequest,
  ) {
    return this.h.rows(req, { kind: 'branch', id: branchId }, previewId, query);
  }

  @Get('previews/:previewId')
  @Require('create:customers:branch', { branch: 'branchId' })
  @RequiresFeature('customers')
  status(
    @Param('branchId', ID_PIPE) branchId: string,
    @Param('previewId', ID_PIPE) previewId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.h.status(req, { kind: 'branch', id: branchId }, previewId);
  }

  @Post('commits')
  @HttpCode(202)
  @Require('create:customers:branch', { branch: 'branchId' })
  @RequiresFeature('customers')
  createCommit(
    @Param('branchId', ID_PIPE) branchId: string,
    @Body(COMMIT_PIPE) input: CommitCustomerImportInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() req: FastifyRequest,
  ) {
    return this.h.createCommit(req, { kind: 'branch', id: branchId }, input, idem);
  }
}
