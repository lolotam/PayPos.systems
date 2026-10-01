import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { id } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { updateRequestContext } from '@pospay/observability';
import { sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';

import { DATABASE } from './database.token.ts';
import { ApiError } from './errors.ts';

/** Session-only personal resources still recheck the selected company's membership before tenant access. */
@Injectable()
export class SelectedCompanyGuard implements CanActivate {
  constructor(@Inject(DATABASE) readonly database: TenantWrappers | null) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const principal = request.principal;
    if (principal?.kind !== 'user' || principal.userId === null) throw new ApiError('FORBIDDEN');
    if (this.database === null) throw new ApiError('NOT_READY');
    const parsed = id.safeParse(request.headers['x-company-id']);
    if (!parsed.success) throw new ApiError('BAD_REQUEST');
    const companyId = parsed.data.toLowerCase();
    const userId = principal.userId;
    const member = await this.database.withUser(userId, async (tx) =>
      tx.execute(sql`SELECT id FROM memberships WHERE user_id = ${userId} AND company_id = ${companyId}
        AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()) LIMIT 1`),
    );
    if (member.length === 0) throw new ApiError('FORBIDDEN');
    request.principal = { ...principal, companyId };
    updateRequestContext({ companyId });
    return true;
  }
}
