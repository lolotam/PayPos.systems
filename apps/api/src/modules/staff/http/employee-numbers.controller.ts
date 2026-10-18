import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import {
  employeeNumberListQuery,
  type EmployeeNumberListQuery,
  type EmployeeNumberPage,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  listEmployeeNumbers,
  type EmployeeNumberSearch,
} from '../queries/list-employee-numbers.query.ts';

export const EMPLOYEE_NUMBERS_SEARCH = Symbol('EMPLOYEE_NUMBERS_SEARCH');

type EmployeeNumbersSearch = (q: string | undefined) => EmployeeNumberSearch | undefined;

@Controller('employee-numbers')
export class EmployeeNumbersController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(EMPLOYEE_NUMBERS_SEARCH) private readonly employeeListSearch: EmployeeNumbersSearch | null,
  ) {}

  @Get()
  @Require('manage:employee-number:company')
  @RequiresFeature('staff')
  async list(
    @Query(new ZodValidationPipe(employeeNumberListQuery)) query: EmployeeNumberListQuery,
    @Req() request: FastifyRequest,
  ): Promise<EmployeeNumberPage> {
    const search = this.employeeListSearch;
    if (this.database === null || search === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    return this.database.withTenant(
      actor.companyId,
      (tx) => listEmployeeNumbers(tx, actor.companyId, actor.userId, query, search(query.q)),
      { userId: actor.userId },
    );
  }
}
