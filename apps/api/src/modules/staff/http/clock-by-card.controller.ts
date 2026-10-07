import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  SetMetadata,
} from '@nestjs/common';
import { clockByCardInput, type ClockByCardInput, type ClockAttendanceResult } from '@pospay/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { STAFF_ROUTE } from '../../../shared/staff-authentication.ts';
import { STAFF_POS_ORIGIN } from '../../../shared/staff-origin.token.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  AttendanceError,
  CardScanAttemptsUnavailableError,
  CardScanLimitedError,
  ClockByCard,
} from '../use-cases/clock-by-card/clock-by-card.ts';

@Controller('devices/me')
export class ClockByCardController {
  constructor(
    @Inject(ClockByCard) private readonly clock: ClockByCard | null,
    @Inject(STAFF_POS_ORIGIN) private readonly origin: string | null,
  ) {}
  @Post('clock-by-card')
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'staff')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async submit(
    @Body(new ZodValidationPipe(clockByCardInput)) input: ClockByCardInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Idempotency() idem: IdempotencyInput,
  ): Promise<ClockAttendanceResult> {
    if (this.origin === null || request.headers.origin !== this.origin)
      throw new ApiError('FORBIDDEN');
    const scope = cardScope(request);
    if (scope === null) throw new ApiError('UNAUTHENTICATED');
    if (this.clock === null) throw new ApiError('NOT_READY');
    try {
      return await this.clock.execute(scope, input, idem);
    } catch (error) {
      throw cardFailure(error, request, reply);
    }
  }
}

function cardScope(request: FastifyRequest) {
  const device = request.staffDevice;
  const session = request.staffSession;
  if (device === undefined || session === undefined || request.principal?.kind !== 'device')
    return null;
  return {
    companyId: device.companyId,
    businessId: device.businessId,
    branchId: device.branchId,
    deviceId: device.deviceId,
    operatorId: session.userId,
    sessionId: session.sessionId,
    sessionDeadline: session.deadline,
  };
}

function cardFailure(error: unknown, request: FastifyRequest, reply: FastifyReply): unknown {
  if (error instanceof CardScanLimitedError) {
    request.log.warn({ outcome: 'limited' }, 'card scan limited');
    void reply.header('retry-after', String(error.remaining));
    return new ApiError('TOO_MANY_REQUESTS');
  }
  if (error instanceof CardScanAttemptsUnavailableError) return new ApiError('NOT_READY');
  if (error instanceof AttendanceError) return new ApiError(error.code);
  if (operatorSessionEnded(error)) return new ApiError('UNAUTHENTICATED');
  return error;
}

function operatorSessionEnded(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'OperatorSessionEnded' &&
    'code' in error &&
    error.code === 'UNAUTHENTICATED'
  );
}
