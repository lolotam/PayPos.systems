import { Controller, Get, Inject, Param, Query, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { attendanceMonthlyReportQuery, id, type AttendanceMonthlyReportQuery } from '@pospay/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Authenticated, Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { AttendanceReportNotFoundFilter } from './attendance-monthly-report.filter.ts';
import { ATTENDANCE_REPORT_READER, type AttendanceReportReader } from './attendance-monthly-report.read.ts';

// كتالوج الإذن يضاف بترحيل 27a؛ النوع المؤقت لا يبدل الإذن الذي يفحصه الـ guard العام.
const permission = 'read:attendance:branch' as Parameters<typeof Require>[0];

@Controller('businesses/:businessId')
export class AttendanceMonthlyReportController {
  constructor(@Inject(ATTENDANCE_REPORT_READER) private readonly read: AttendanceReportReader | null) {}

  @Get('branches/:branchId/attendance-report')
  @Require(permission, { branch: 'branchId' })
  @RequiresFeature('staff')
  @UseFilters(AttendanceReportNotFoundFilter)
  report(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Query(new ZodValidationPipe(attendanceMonthlyReportQuery)) query: AttendanceMonthlyReportQuery,
    @Req() request: FastifyRequest,
  ) {
    return this.readReport(request, query, businessId, branchId);
  }

  @Get('branches/:branchId/attendance-report.csv')
  @Require(permission, { branch: 'branchId' })
  @RequiresFeature('staff')
  @UseFilters(AttendanceReportNotFoundFilter)
  csv(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Query(new ZodValidationPipe(attendanceMonthlyReportQuery)) query: AttendanceMonthlyReportQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.csvReport(request, reply, query, businessId, branchId);
  }

  @Get('attendance-report')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  all(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Query(new ZodValidationPipe(attendanceMonthlyReportQuery)) query: AttendanceMonthlyReportQuery,
    @Req() request: FastifyRequest,
  ) {
    return this.readReport(request, query, businessId, 'all');
  }

  @Get('attendance-report.csv')
  @Authenticated()
  @UseGuards(SelectedCompanyGuard)
  allCsv(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Query(new ZodValidationPipe(attendanceMonthlyReportQuery)) query: AttendanceMonthlyReportQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.csvReport(request, reply, query, businessId, 'all');
  }

  private readReport(request: FastifyRequest, query: AttendanceMonthlyReportQuery,
    businessId: string, branchId: string, csv = false) {
    if (!this.read) throw new ApiError('NOT_READY');
    return this.read(actorOf(request), query, businessId.toLowerCase(), branchId.toLowerCase(), csv);
  }

  private async csvReport(request: FastifyRequest, reply: FastifyReply, query: AttendanceMonthlyReportQuery,
    businessId: string, branchId: string) {
    const content = await this.readReport(request, query, businessId, branchId, true);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="attendance-${query.month}.csv"`);
    reply.header('Cache-Control', 'private, no-store');
    return content;
  }
}
