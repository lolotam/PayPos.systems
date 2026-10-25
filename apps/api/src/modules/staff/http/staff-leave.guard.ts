import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../../../shared/errors.ts';
import {
  isStaffOrigin,
  STAFF_POS_ORIGIN,
  type StaffOrigins,
} from '../../../shared/staff-origin.token.ts';
@Injectable()
export class StaffLeaveGuard implements CanActivate {
  constructor(@Inject(STAFF_POS_ORIGIN) private readonly origin: StaffOrigins | null) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.personalSession && request.personalEmployeeId) return true;
    if (
      !isStaffOrigin(this.origin, request.headers.origin) ||
      !request.staffSession ||
      !request.staffDevice
    )
      throw new ApiError('FORBIDDEN');
    return true;
  }
}
