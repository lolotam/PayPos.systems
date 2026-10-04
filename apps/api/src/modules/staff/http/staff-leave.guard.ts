import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../../../shared/errors.ts';
import { STAFF_POS_ORIGIN } from '../../../shared/staff-origin.token.ts';
@Injectable()
export class StaffLeaveGuard implements CanActivate {
  constructor(@Inject(STAFF_POS_ORIGIN) private readonly origin: string | null) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (
      this.origin === null ||
      request.headers.origin !== this.origin ||
      !request.staffSession ||
      !request.staffDevice
    )
      throw new ApiError('FORBIDDEN');
    return true;
  }
}
