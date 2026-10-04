import { Body, Controller, Header, HttpCode, Inject, Post, Req, SetMetadata } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import {
  clockChallengeInput,
  clockAttendanceInput,
  type ClockChallengeInput,
  type ClockAttendanceInput,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { PERSONAL_ROUTE } from '../../../shared/personal-authentication.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  ClockAttendance,
  AttendanceError,
} from '../use-cases/clock-attendance/clock-attendance.ts';
import { AttendanceQrUnavailableError } from '../use-cases/issue-attendance-qr/issue-attendance-qr.ts';
import { RequestClockChallenge } from '../use-cases/request-clock-challenge/request-clock-challenge.ts';

@Controller('staff/attendance')
export class ClockAttendanceController {
  constructor(
    @Inject(RequestClockChallenge) private readonly challenges: RequestClockChallenge | null,
    @Inject(ClockAttendance) private readonly clock: ClockAttendance | null,
  ) {}
  @Post('challenge')
  @Authenticated()
  @SetMetadata(PERSONAL_ROUTE, true)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async challenge(
    @Body(new ZodValidationPipe(clockChallengeInput)) input: ClockChallengeInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.challenges === null) throw new ApiError('NOT_READY');
    try {
      return await this.challenges.execute(scopeOf(request), input);
    } catch (error) {
      throw attendanceFailure(error);
    }
  }
  @Post('clock')
  @Authenticated()
  @SetMetadata(PERSONAL_ROUTE, true)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RouteConfig({ bodyLimit: 196608 })
  async submit(
    @Body(new ZodValidationPipe(clockAttendanceInput)) input: ClockAttendanceInput,
    @Req() request: FastifyRequest,
    @Idempotency({ omitBodyFields: ['installation_id'] }) idem: IdempotencyInput,
  ) {
    if (this.clock === null) throw new ApiError('NOT_READY');
    try {
      return await this.clock.execute(scopeOf(request), input, idem);
    } catch (error) {
      throw attendanceFailure(error);
    }
  }
}
function attendanceFailure(error: unknown): unknown {
  if (error instanceof AttendanceError) return new ApiError(error.code);
  if (error instanceof AttendanceQrUnavailableError) return new ApiError('NOT_READY');
  return error;
}
function scopeOf(request: FastifyRequest) {
  const session = request.personalSession;
  if (session === undefined || request.personalEmployeeId === undefined)
    throw new ApiError('UNAUTHENTICATED');
  return {
    userId: session.userId,
    sessionId: session.sessionId,
    companyId: session.context.companyId,
    businessId: session.context.businessId,
    employeeId: request.personalEmployeeId,
  };
}
