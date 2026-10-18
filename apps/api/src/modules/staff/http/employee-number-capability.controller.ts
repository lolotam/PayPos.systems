import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  employeeNumberCapabilityQuery,
  id,
  type EmployeeNumberCapabilityQuery,
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
  EMPLOYEE_NUMBER_CAPABILITY_ACCESS,
  readEmployeeNumberCapability,
  type EmployeeNumberCapabilityAccess,
} from '../queries/employee-number-capability.query.ts';

@Controller('businesses/:businessId/employee-number-capability')
export class EmployeeNumberCapabilityController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(EMPLOYEE_NUMBER_CAPABILITY_ACCESS)
    private readonly access: EmployeeNumberCapabilityAccess | null,
  ) {}

  @Get()
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  async read(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Query(new ZodValidationPipe(employeeNumberCapabilityQuery)) query: EmployeeNumberCapabilityQuery,
    @Req() request: FastifyRequest,
  ) {
    if (this.database === null || this.access === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const access = this.access;
    const result = await this.database.withTenant(
      actor.companyId,
      (tx) =>
        readEmployeeNumberCapability(
          tx,
          actor.companyId,
          actor.userId,
          businessId,
          query.primary_branch_id,
          access,
        ),
      { userId: actor.userId },
    );
    if (typeof result === 'string') throw new ApiError(result);
    return result;
  }
}
