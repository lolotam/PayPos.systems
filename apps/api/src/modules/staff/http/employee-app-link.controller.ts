import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import { id } from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import type { EmployeeAppLinkNames } from '../ports/employee-app-link-names.port.ts';
import { readEmployeeAppLink } from '../queries/employee-app-link.query.ts';

export const EMPLOYEE_APP_LINK_NAMES = Symbol('EMPLOYEE_APP_LINK_NAMES');
export type EmployeeAppLinkNamesFactory = (tx: Tx) => EmployeeAppLinkNames;

@Controller('businesses/:businessId/staff/employee-app-link')
export class EmployeeAppLinkController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(EMPLOYEE_APP_LINK_NAMES) private readonly names: EmployeeAppLinkNamesFactory,
  ) {}

  @Get()
  @Require('manage:employees:business', { business: 'businessId' })
  @RequiresFeature('staff')
  async read(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!this.database) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const result = await this.database.withTenant(
      actor.companyId,
      (tx) => readEmployeeAppLink(this.names(tx), actor.companyId, businessId),
      { userId: actor.userId },
    );
    // النشاط لو اختفى بين الحارس والقراءة يرجع 403 زي كل رفض، عشان الرد ما يكشفش وجوده.
    if (result === null) throw new ApiError('FORBIDDEN');
    return result;
  }
}
