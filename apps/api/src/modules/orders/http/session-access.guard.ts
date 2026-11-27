import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { appendServiceSessionLinesInput, id } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { updateRequestContext } from '@pospay/observability';
import { ApiError } from '../../../shared/errors.ts';

export { SessionAdminGuard } from '../../../shared/session-admin.guard.ts';
@Injectable()
export class SessionAppendGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.principal?.kind !== 'user') throw new ApiError('FORBIDDEN');
    const params = request.params as Record<string, string>;
    const pathId = id.toLowerCase();
    const business = pathId.safeParse(params['businessId']), branch = pathId.safeParse(params['branchId']), session = pathId.safeParse(params['sessionId']);
    if (!business.success || !branch.success || !session.success) throw new ApiError('VALIDATION_FAILED');
    const body = appendServiceSessionLinesInput.safeParse(request.body);
    if (!body.success) throw new ApiError('VALIDATION_FAILED');
    updateRequestContext({ branchId: branch.data });
    return true;
  }
}
