import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import {
  createDocumentTypeInput,
  documentTypeRevisionInput,
  id,
  updateDocumentTypeInput,
  type CreateDocumentTypeInput,
  type DocumentTypeRevisionInput,
  type UpdateDocumentTypeInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { listDocumentTypes } from '../queries/document-types.query.ts';
import { CreateDocumentTypeUseCase } from '../use-cases/create-document-type/create-document-type.usecase.ts';
import { DeactivateDocumentTypeUseCase } from '../use-cases/deactivate-document-type/deactivate-document-type.usecase.ts';
import { ReactivateDocumentTypeUseCase } from '../use-cases/reactivate-document-type/reactivate-document-type.usecase.ts';
import { UpdateDocumentTypeUseCase } from '../use-cases/update-document-type/update-document-type.usecase.ts';
import { documentHttpResult } from './document-errors.ts';

@Controller('document-types')
export class DocumentTypesController {
  constructor(
    @Inject(CreateDocumentTypeUseCase) private readonly create: CreateDocumentTypeUseCase | null,
    @Inject(UpdateDocumentTypeUseCase) private readonly update: UpdateDocumentTypeUseCase | null,
    @Inject(DeactivateDocumentTypeUseCase)
    private readonly deactivate: DeactivateDocumentTypeUseCase | null,
    @Inject(ReactivateDocumentTypeUseCase)
    private readonly reactivate: ReactivateDocumentTypeUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
  ) {}
  @Get()
  @Require('manage:document-types:company')
  @RequiresFeature('staff')
  async list(@Req() request: FastifyRequest) {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    return this.database.withTenant(
      actor.companyId,
      (tx) => listDocumentTypes(tx, actor.companyId),
      {
        userId: actor.userId,
      },
    );
  }
  @Post()
  @HttpCode(201)
  @Require('manage:document-types:company')
  @RequiresFeature('staff')
  add(
    @Body(new ZodValidationPipe(createDocumentTypeInput)) input: CreateDocumentTypeInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.create === null) throw new ApiError('NOT_READY');
    return documentHttpResult(this.create.execute({ ...actorOf(request), ...idem, input }));
  }
  @Patch(':typeId')
  @Require('manage:document-types:company')
  @RequiresFeature('staff')
  edit(
    @Param('typeId', new ZodValidationPipe(id)) typeId: string,
    @Body(new ZodValidationPipe(updateDocumentTypeInput)) input: UpdateDocumentTypeInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.update === null) throw new ApiError('NOT_READY');
    return documentHttpResult(this.update.execute({ ...actorOf(request), ...idem, typeId, input }));
  }
  @Post(':typeId/deactivate')
  @HttpCode(200)
  @Require('manage:document-types:company')
  @RequiresFeature('staff')
  off(
    @Param('typeId', new ZodValidationPipe(id)) typeId: string,
    @Body(new ZodValidationPipe(documentTypeRevisionInput)) input: DocumentTypeRevisionInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.deactivate === null) throw new ApiError('NOT_READY');
    const expectedRevision = input.expected_revision;
    return documentHttpResult(
      this.deactivate.execute({ ...actorOf(request), ...idem, typeId, expectedRevision }),
    );
  }
  @Post(':typeId/reactivate')
  @HttpCode(200)
  @Require('manage:document-types:company')
  @RequiresFeature('staff')
  on(
    @Param('typeId', new ZodValidationPipe(id)) typeId: string,
    @Body(new ZodValidationPipe(documentTypeRevisionInput)) input: DocumentTypeRevisionInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.reactivate === null) throw new ApiError('NOT_READY');
    const expectedRevision = input.expected_revision;
    return documentHttpResult(
      this.reactivate.execute({ ...actorOf(request), ...idem, typeId, expectedRevision }),
    );
  }
}
