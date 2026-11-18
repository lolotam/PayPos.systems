import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiError } from './errors.ts';

@Injectable()
export class SessionAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.switchToHttp().getRequest<FastifyRequest>().principal?.kind !== 'user') throw new ApiError('FORBIDDEN');
    return true;
  }
}
