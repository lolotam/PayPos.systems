import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
import { id } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  EMPLOYEE_NUMBER_EDIT_CAPABILITY_ACCESS,
  readEmployeeNumberEditCapability,
  type EmployeeNumberEditCapabilityAccess,
} from '../queries/employee-number-edit-capability.query.ts';

@Controller('businesses/:businessId/employees/:employeeId/employee-number-capability')
export class EmployeeNumberEditCapabilityController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(EMPLOYEE_NUMBER_EDIT_CAPABILITY_ACCESS)
    private readonly access: EmployeeNumberEditCapabilityAccess | null,
  ) {}

  @Get()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async read(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id)) employeeId: string,
    @Req() request: FastifyRequest,
  ) {
    if (this.database === null || this.access === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const access = this.access;
    const result = await this.database.withTenant(
      actor.companyId,
      (tx) =>
        readEmployeeNumberEditCapability(
          tx,
          actor.companyId,
          actor.userId,
          businessId,
          employeeId,
          access,
        ),
      { userId: actor.userId },
    );
    if (typeof result === 'string') throw new ApiError(result);
    return result;
  }
}
