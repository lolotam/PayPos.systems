import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { id, type Employee } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import {
  employeeDetail,
  EMPLOYEE_DETAIL_ACCESS,
  type EmployeeDetailAccess,
} from '../queries/employee-detail.query.ts';

export interface EmployeeDetailRequest extends FastifyRequest {
  employeeRecord?: Employee;
}

/** إذن الموظف يتطلب الفرع المحفوظ؛ فحص النشاط وحده يخفي ALLOW الفرع ويتجاوز DENY عليه. */
@Injectable()
export class EmployeeDetailGuard implements CanActivate {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(EMPLOYEE_DETAIL_ACCESS) private readonly access: EmployeeDetailAccess | null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.database === null || this.access === null) throw new ApiError('NOT_READY');
    const request = context.switchToHttp().getRequest<EmployeeDetailRequest>();
    const params = (request.params ?? {}) as Record<string, unknown>;
    const businessId = id.safeParse(params['businessId']);
    const employeeId = id.safeParse(params['employeeId']);
    if (!businessId.success || !employeeId.success) throw new ApiError('VALIDATION_FAILED');
    const actor = actorOf(request);
    const access = this.access;
    const record = await this.database.withTenant(
      actor.companyId,
      (tx) =>
        employeeDetail(tx, actor.companyId, businessId.data, employeeId.data, actor.userId, access),
      { userId: actor.userId },
    );
    if (record === null) throw new ApiError('NOT_FOUND');
    if (record === 'FEATURE_DISABLED') throw new ApiError('FEATURE_DISABLED');
    request.employeeRecord = record;
    return true;
  }
}
