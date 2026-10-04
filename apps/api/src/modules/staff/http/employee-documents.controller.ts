import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  id,
  recordEmployeeDocumentInput,
  type RecordEmployeeDocumentInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  EMPLOYEE_DOCUMENT_ACCESS,
  employeeDocuments,
  type EmployeeDocumentReadAccess,
} from '../queries/employee-documents.query.ts';
import { RecordEmployeeDocumentUseCase } from '../use-cases/record-employee-document/record-employee-document.usecase.ts';
import { documentHttpResult } from './document-errors.ts';

@Controller('businesses/:businessId/employees/:employeeId/documents')
export class EmployeeDocumentsController {
  constructor(
    @Inject(RecordEmployeeDocumentUseCase)
    private readonly record: RecordEmployeeDocumentUseCase | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(EMPLOYEE_DOCUMENT_ACCESS) private readonly access: EmployeeDocumentReadAccess | null,
  ) {}
  @Get()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async list(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Req() request: FastifyRequest,
  ) {
    if (this.database === null || this.access === null) throw new ApiError('NOT_READY');
    const context = { ...actorOf(request), businessId, employeeId };
    const access = this.access;
    const result = await this.database.withTenant(
      context.companyId,
      (tx) => employeeDocuments(tx, context, access),
      { userId: context.userId },
    );
    if (result === null) throw new ApiError('NOT_FOUND');
    if (result === 'FEATURE_DISABLED') throw new ApiError('FEATURE_DISABLED');
    return result;
  }
  @Post()
  @HttpCode(200)
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  add(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Body(new ZodValidationPipe(recordEmployeeDocumentInput)) input: RecordEmployeeDocumentInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.record === null) throw new ApiError('NOT_READY');
    return documentHttpResult(
      this.record.execute({ ...actorOf(request), ...idem, businessId, employeeId, input }),
    );
  }
}
