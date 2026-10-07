import { Body, Controller, Header, HttpCode, Inject, Post, Req, SetMetadata } from '@nestjs/common';
import { clockByCardInput, type ClockByCardInput, type ClockAttendanceResult } from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { STAFF_ROUTE } from '../../../shared/staff-authentication.ts';
import { STAFF_POS_ORIGIN } from '../../../shared/staff-origin.token.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { ClockByCard, AttendanceError } from '../use-cases/clock-by-card/clock-by-card.ts';

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
    @Idempotency() idem: IdempotencyInput,
  ): Promise<ClockAttendanceResult> {
    if (this.origin === null || request.headers.origin !== this.origin)
      throw new ApiError('FORBIDDEN');
    const device = request.staffDevice;
    const operator = request.staffSession?.userId;
    if (device === undefined || operator === undefined || request.principal?.kind !== 'device')
      throw new ApiError('UNAUTHENTICATED');
    if (this.clock === null) throw new ApiError('NOT_READY');
    try {
      return await this.clock.execute(
        {
          companyId: device.companyId,
          businessId: device.businessId,
          branchId: device.branchId,
          deviceId: device.deviceId,
          operatorId: operator,
        },
        input,
        idem,
      );
    } catch (error) {
      if (error instanceof AttendanceError) throw new ApiError(error.code);
      throw error;
    }
  }
}
