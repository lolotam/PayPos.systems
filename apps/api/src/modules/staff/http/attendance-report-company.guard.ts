import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { updateRequestContext } from '@pospay/observability';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../../../shared/errors.ts';
import { ATTENDANCE_REPORT_COMPANY, type AttendanceReportCompany } from './attendance-monthly-report.tokens.ts';

@Injectable()
export class AttendanceReportCompanyGuard implements CanActivate {
  constructor(@Inject(ATTENDANCE_REPORT_COMPANY) private readonly verify: AttendanceReportCompany | null) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const principal = request.principal;
    const header = request.headers['x-company-id'];
    const requested = header === undefined ? request.companyHint : header;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!principal?.userId || !this.verify || typeof requested !== 'string' || !uuid.test(requested))
      throw new ApiError('FORBIDDEN');
    const companyId = requested.toLowerCase();
    if (!(await this.verify(principal.userId, companyId))) throw new ApiError('FORBIDDEN');
    request.principal = { ...principal, companyId };
    updateRequestContext({ companyId });
    return true;
  }
}
