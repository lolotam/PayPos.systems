import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { id } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { updateRequestContext } from '@pospay/observability';
import { sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';

import { DATABASE } from './database.token.ts';
import { ApiError } from './errors.ts';

/**
 * Session-only resources need an active membership and an open company, read together in one
 * withTenant so the guard checks out a single pool connection.
 */
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
    const open = await this.database.withTenant(
      companyId,
      async (tx) => {
        const membership = await tx.execute(
          sql`SELECT id FROM memberships WHERE user_id = ${userId} AND company_id = ${companyId}
        AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()) LIMIT 1`,
        );
        if (membership.length === 0) return false;
        const company = await tx.execute(
          sql`SELECT id FROM companies WHERE id = ${companyId} AND deleted_at IS NULL`,
        );
        return company.length > 0;
      },
      { userId },
    );
    if (!open) throw new ApiError('FORBIDDEN');
    request.principal = { ...principal, companyId };
    updateRequestContext({ companyId });
    return true;
  }
}
