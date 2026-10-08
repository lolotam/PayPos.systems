import { Body, Controller, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { correctAttendanceInput, id, type CorrectAttendanceInput } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { SelectedCompanyGuard } from '../../../shared/selected-company.guard.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { CorrectAttendanceUseCase } from '../use-cases/correct-attendance/correct-attendance.usecase.ts';
import { attendanceCorrectionHttpResult } from './attendance-correction-http.ts';

@Controller('businesses/:businessId/attendance-sessions')
@UseGuards(SelectedCompanyGuard)
export class AttendanceCorrectionsController {
  constructor(
    @Inject(CorrectAttendanceUseCase)
    private readonly correct: CorrectAttendanceUseCase | null,
  ) {}
  @Post(':sessionId/correct')
  @HttpCode(200)
  @Authenticated()
  correctSession(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('sessionId', new ZodValidationPipe(id)) sessionId: string,
    @Body(new ZodValidationPipe(correctAttendanceInput)) input: CorrectAttendanceInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() req: FastifyRequest,
  ) {
    if (!this.correct) throw new ApiError('NOT_READY');
    return attendanceCorrectionHttpResult(
      this.correct.execute({ ...actorOf(req), ...idem, businessId, sessionId }, input),
    );
  }
}
