import { Body, Controller, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  attendanceExceptionDecisionInput,
  id,
  type AttendanceExceptionDecisionInput,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { ReopenAttendanceExceptionUseCase } from '../use-cases/reopen-attendance-exception/reopen-attendance-exception.usecase.ts';
import { ResolveAttendanceExceptionUseCase } from '../use-cases/resolve-attendance-exception/resolve-attendance-exception.usecase.ts';
import { attendanceExceptionHttpResult } from './attendance-exception-http.ts';

@Controller('businesses/:businessId/attendance-exceptions')
@UseGuards(SelectedCompanyGuard)
export class AttendanceExceptionsController {
  constructor(
    @Inject(ResolveAttendanceExceptionUseCase)
    private readonly resolve: ResolveAttendanceExceptionUseCase | null,
    @Inject(ReopenAttendanceExceptionUseCase)
    private readonly reopen: ReopenAttendanceExceptionUseCase | null,
  ) {}
  @Post(':exceptionId/resolve')
  @HttpCode(200)
  @Authenticated()
  resolveException(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('exceptionId', new ZodValidationPipe(id)) exceptionId: string,
    @Body(new ZodValidationPipe(attendanceExceptionDecisionInput))
    input: AttendanceExceptionDecisionInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() req: FastifyRequest,
  ) {
    if (!this.resolve) throw new ApiError('NOT_READY');
    return attendanceExceptionHttpResult(
      this.resolve.execute({ ...actorOf(req), ...idem, businessId, exceptionId }, input),
    );
  }
  @Post(':exceptionId/reopen')
  @HttpCode(200)
  @Authenticated()
  reopenException(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('exceptionId', new ZodValidationPipe(id)) exceptionId: string,
    @Body(new ZodValidationPipe(attendanceExceptionDecisionInput))
    input: AttendanceExceptionDecisionInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() req: FastifyRequest,
  ) {
    if (!this.reopen) throw new ApiError('NOT_READY');
    return attendanceExceptionHttpResult(
      this.reopen.execute({ ...actorOf(req), ...idem, businessId, exceptionId }, input),
    );
  }
}
