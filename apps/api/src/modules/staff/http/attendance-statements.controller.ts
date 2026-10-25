import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import {
  attendanceStatementRequest,
  attendanceStatementShiftsQuery,
  id,
  type AttendanceStatementRequest,
  type AttendanceStatementShiftsQuery,
} from '@pospay/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  ATTENDANCE_STATEMENT_SHIFTS_QUERY,
  type AttendanceStatementShiftsQuery as ShiftsQuery,
} from '../queries/attendance-statement-shifts.query.ts';
import {
  ATTENDANCE_STATEMENT_STATUS_QUERY,
  type AttendanceStatementStatusQuery,
} from '../queries/attendance-statement-status.query.ts';
import { CollectAttendanceStatementUseCase } from '../use-cases/collect-attendance-statement/collect-attendance-statement.usecase.ts';
import { RequestAttendanceStatementUseCase } from '../use-cases/request-attendance-statement/request-attendance-statement.usecase.ts';
import { AttendanceStatementErrorFilter } from './attendance-statement.filter.ts';

// اسم الملف ASCII، والنسخة المشفّرة بتوصل لنفس الاسم في المتصفحات القديمة (RFC 5987).
function contentDisposition(filename: string): string {
  return `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

@Controller('businesses/:businessId')
@UseFilters(AttendanceStatementErrorFilter)
export class AttendanceStatementsController {
  constructor(
    @Inject(RequestAttendanceStatementUseCase)
    private readonly request: RequestAttendanceStatementUseCase | null,
    @Inject(CollectAttendanceStatementUseCase)
    private readonly collect: CollectAttendanceStatementUseCase | null,
    @Inject(ATTENDANCE_STATEMENT_STATUS_QUERY)
    private readonly statusRead: AttendanceStatementStatusQuery | null,
    @Inject(ATTENDANCE_STATEMENT_SHIFTS_QUERY) private readonly shiftsRead: ShiftsQuery | null,
  ) {}

  @Post('branches/:branchId/attendance-statements')
  @HttpCode(202)
  @Require('read:attendance:branch', { branch: 'branchId' })
  @RequiresFeature('staff')
  async requestStatement(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Body(new ZodValidationPipe(attendanceStatementRequest)) input: AttendanceStatementRequest,
    @Req() request: FastifyRequest,
  ) {
    const requestUseCase = this.request;
    if (requestUseCase === null) throw new ApiError('NOT_READY');
    return requestUseCase.execute({
      ...actorOf(request),
      businessId: businessId.toLowerCase(),
      branchId: branchId.toLowerCase(),
      input,
    });
  }

  @Get('branches/:branchId/attendance-statements/:renderId')
  @Require('read:attendance:branch', { branch: 'branchId' })
  @RequiresFeature('staff')
  async status(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Param('renderId', new ZodValidationPipe(id)) renderId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const statusRead = this.statusRead;
    if (statusRead === null) throw new ApiError('NOT_READY');
    reply.header('Cache-Control', 'no-store');
    const actor = actorOf(request);
    return statusRead(
      {
        companyId: actor.companyId,
        userId: actor.userId,
        businessId: businessId.toLowerCase(),
        branchId: branchId.toLowerCase(),
      },
      renderId.toLowerCase(),
    );
  }

  @Post('branches/:branchId/attendance-statements/:renderId/download')
  @HttpCode(200)
  @Require('read:attendance:branch', { branch: 'branchId' })
  @RequiresFeature('staff')
  async download(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Param('renderId', new ZodValidationPipe(id)) renderId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const collect = this.collect;
    if (collect === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const result = await collect.execute({
      companyId: actor.companyId,
      userId: actor.userId,
      businessId: businessId.toLowerCase(),
      branchId: branchId.toLowerCase(),
      renderId: renderId.toLowerCase(),
    });
    reply.header('Content-Type', result.mimeType);
    reply.header('Content-Disposition', contentDisposition(result.filename));
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    return Buffer.from(result.bytes);
  }

  @Get('branches/:branchId/attendance-statement-shifts')
  @Require('read:attendance:branch', { branch: 'branchId' })
  @RequiresFeature('staff')
  async shifts(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Query(new ZodValidationPipe(attendanceStatementShiftsQuery))
    query: AttendanceStatementShiftsQuery,
    @Req() request: FastifyRequest,
  ) {
    const shiftsRead = this.shiftsRead;
    if (shiftsRead === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const scope = {
      companyId: actor.companyId,
      userId: actor.userId,
      businessId: businessId.toLowerCase(),
      branchId: branchId.toLowerCase(),
    };
    return shiftsRead(scope, query);
  }
}
