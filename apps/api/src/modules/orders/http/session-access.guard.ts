import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { appendServiceSessionLinesInput, id } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { updateRequestContext } from '@pospay/observability';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { AppendServiceSessionLinesUseCase } from '../use-cases/append-service-session-lines/append-service-session-lines.usecase.ts';

@Injectable()
export class SessionAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.switchToHttp().getRequest<FastifyRequest>().principal?.kind !== 'user') throw new ApiError('FORBIDDEN');
    return true;
  }
}
@Injectable()
export class SessionAppendGuard implements CanActivate {
  constructor(@Inject(AppendServiceSessionLinesUseCase) private readonly append: AppendServiceSessionLinesUseCase | null) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.principal?.kind !== 'user') throw new ApiError('FORBIDDEN');
    if (this.append === null) throw new ApiError('NOT_READY');
    const params = request.params as Record<string, string>;
    const pathId = id.toLowerCase();
    const business = pathId.safeParse(params['businessId']), branch = pathId.safeParse(params['branchId']), session = pathId.safeParse(params['sessionId']);
    if (!business.success || !branch.success || !session.success) throw new ApiError('VALIDATION_FAILED');
    const body = appendServiceSessionLinesInput.safeParse(request.body);
    if (!body.success) throw new ApiError('VALIDATION_FAILED');
    await this.append.authorize({ ...actorOf(request), businessId: business.data, branchId: branch.data, sessionId: session.data,
      ...(body.data.recorder_membership_id === undefined ? {} : { membershipId: body.data.recorder_membership_id }), key: '', fingerprint: '' });
    updateRequestContext({ branchId: branch.data });
    return true;
  }
}
