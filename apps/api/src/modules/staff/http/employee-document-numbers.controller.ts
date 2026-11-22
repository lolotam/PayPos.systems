import { Controller, Get, Header, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  id,
  employeeDocumentNumbersQuery,
  type EmployeeDocumentNumbersQuery,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  EMPLOYEE_DOCUMENT_ACCESS,
  type EmployeeDocumentReadAccess,
} from '../queries/employee-documents.query.ts';
import { readEmployeeDocumentNumbers } from '../queries/employee-document-numbers.query.ts';

@Controller('businesses/:businessId/employee-document-numbers')
export class EmployeeDocumentNumbersController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(EMPLOYEE_DOCUMENT_ACCESS) private readonly access: EmployeeDocumentReadAccess | null,
  ) {}
  @Get()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  @Header('Cache-Control', 'no-store')
  async numbers(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Query(new ZodValidationPipe(employeeDocumentNumbersQuery)) query: EmployeeDocumentNumbersQuery,
    @Req() request: FastifyRequest,
  ) {
    if (this.database === null || this.access === null) throw new ApiError('NOT_READY');
    const context = { ...actorOf(request), businessId };
    const access = this.access;
    const result = await this.database.withTenant(
      context.companyId,
      (tx) => readEmployeeDocumentNumbers(tx, context, query.ids, access),
      { userId: context.userId, readOnly: true },
    );
    if (result === null) throw new ApiError('NOT_FOUND');
    if (result === 'FEATURE_DISABLED') throw new ApiError('FEATURE_DISABLED');
    return result;
  }
}
