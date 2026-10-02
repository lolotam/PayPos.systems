import { Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { AttendanceQrIssue } from '@pospay/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { ApiError } from '../../../shared/errors.ts';
import {
  AttendanceQrBranchMissingError,
  AttendanceQrUnavailableError,
  IssueAttendanceQr,
} from '../use-cases/issue-attendance-qr/issue-attendance-qr.ts';

@Controller('devices/me')
export class AttendanceQrController {
  constructor(@Inject(IssueAttendanceQr) private readonly issue: IssueAttendanceQr | null) {}

  @Post('attendance-qr')
  @HttpCode(200)
  @Authenticated()
  async create(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AttendanceQrIssue> {
    void reply.header('Cache-Control', 'no-store');
    const principal = request.principal;
    const branch = principal?.memberships[0];
    if (
      principal?.kind !== 'device' ||
      principal.deviceId === null ||
      branch?.scopeType !== 'BRANCH'
    ) {
      throw new ApiError('FORBIDDEN');
    }
    if (this.issue === null) throw new ApiError('NOT_READY');
    try {
      return await this.issue.execute({ companyId: branch.companyId, branchId: branch.scopeId });
    } catch (error) {
      if (error instanceof AttendanceQrBranchMissingError) throw new ApiError('NOT_FOUND');
      if (error instanceof AttendanceQrUnavailableError) throw new ApiError('NOT_READY');
      throw error;
    }
  }
}
