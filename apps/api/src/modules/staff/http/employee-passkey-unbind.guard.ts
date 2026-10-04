import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { id } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import {
  managerPasskeyEmployee,
  MANAGER_PASSKEY_ACCESS,
  type ManagerPasskeyAccess,
} from '../queries/passkey-access.ts';

@Injectable()
export class EmployeePasskeyUnbindGuard implements CanActivate {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(MANAGER_PASSKEY_ACCESS) private readonly access: ManagerPasskeyAccess | null,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.database === null || this.access === null) throw new ApiError('NOT_READY');
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const params = (request.params ?? {}) as Record<string, unknown>;
    const business = id.safeParse(params['businessId']),
      employee = id.safeParse(params['employeeId']);
    if (!business.success || !employee.success) throw new ApiError('VALIDATION_FAILED');
    const actor = actorOf(request),
      access = this.access;
    const target = await this.database.withTenant(
      actor.companyId,
      (tx) =>
        managerPasskeyEmployee(
          tx,
          { ...actor, businessId: business.data, employeeId: employee.data },
          access,
        ),
      { userId: actor.userId },
    );
    if (target === null || !target.unbindAllowed) throw new ApiError('NOT_FOUND');
    if (!target.featureEnabled) throw new ApiError('FEATURE_DISABLED');
    return true;
  }
}
