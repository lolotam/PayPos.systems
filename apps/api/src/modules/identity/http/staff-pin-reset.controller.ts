import { Body, Controller, HttpCode, Inject, Post, Req, Res, SetMetadata } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import {
  STAFF_PIN_RESET_LIFETIME_MS,
  STAFF_PIN_RESET_RETRY_MS,
  type StaffPinResetApi,
} from '@pospay/auth';
import {
  staffPinResetOtpInput,
  staffPinResetRequestInput,
  type StaffPinResetAcknowledgement,
  type StaffPinResetOtpInput,
  type StaffPinResetRequestInput,
} from '@pospay/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { AllowClosedCompanyDeviceOtp } from '../../../shared/session.guard.ts';
import { ApiError } from '../../../shared/errors.ts';
import { STAFF_AUTH_BODY_BYTES } from '../../../shared/staff-input-limits.ts';
import { STAFF_ROUTE } from '../../../shared/staff-authentication.ts';
import {
  isStaffOrigin,
  STAFF_POS_ORIGIN,
  type StaffOrigins,
} from '../../../shared/staff-origin.token.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';

export const STAFF_PIN_RESET_API = Symbol('STAFF_PIN_RESET_API');
/** نفس بوابة شجرة 076: المسارين مقفولين طول ما مسارات دخول الموظفات مقفولة. */
export const STAFF_PIN_RESET_ENABLED = Symbol('STAFF_PIN_RESET_ENABLED');

/** استعادة الموظفة رقمها السري بنفسها بكود على الإيميل أو الواتساب، على جهاز فرع مقترن. */
@Controller('devices/me/staff-pin/otp')
export class StaffPinResetController {
  constructor(
    @Inject(STAFF_PIN_RESET_API) private readonly otp: StaffPinResetApi | null,
    @Inject(STAFF_POS_ORIGIN) private readonly origin: StaffOrigins | null,
    @Inject(STAFF_PIN_RESET_ENABLED) private readonly enabled: boolean,
  ) {}

  @Post('request')
  @RouteConfig({ bodyLimit: STAFF_AUTH_BODY_BYTES })
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'device')
  // شركة مقفولة بتاخد نفس الرد الموحّد بدل رفض مختلف يكشف حالتها (spec 079 PR-c1).
  @AllowClosedCompanyDeviceOtp()
  @HttpCode(202)
  async request(
    @Body(new ZodValidationPipe(staffPinResetRequestInput)) input: StaffPinResetRequestInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StaffPinResetAcknowledgement> {
    const device = this.device(request);
    if (this.otp === null) throw new ApiError('OTP_UNAVAILABLE');
    const result = await this.otp.request({ ...input, ip: request.ip, device });
    if (result.kind === 'unavailable') throw new ApiError('OTP_UNAVAILABLE');
    if (result.kind === 'limited') {
      void reply.header('retry-after', result.retryAfter);
      throw new ApiError('TOO_MANY_REQUESTS');
    }
    return {
      status: 'ACCEPTED',
      challenge_id: result.challengeId,
      expires_in: STAFF_PIN_RESET_LIFETIME_MS / 1000,
      retry_after: STAFF_PIN_RESET_RETRY_MS / 1000,
    } as StaffPinResetAcknowledgement;
  }

  @Post('reset')
  @RouteConfig({ bodyLimit: STAFF_AUTH_BODY_BYTES })
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'device')
  @HttpCode(204)
  async reset(
    @Body(new ZodValidationPipe(staffPinResetOtpInput)) input: StaffPinResetOtpInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const device = this.device(request);
    if (this.otp === null) throw new ApiError('OTP_UNAVAILABLE');
    const result = await this.otp.reset({
      challengeId: input.challenge_id,
      code: input.code,
      pin: input.pin,
      ip: request.ip,
      device,
    });
    if (result.kind === 'unavailable') throw new ApiError('OTP_UNAVAILABLE');
    if (result.kind === 'limited') {
      void reply.header('retry-after', result.retryAfter);
      throw new ApiError('TOO_MANY_REQUESTS');
    }
    if (result.kind !== 'reset') throw new ApiError('OTP_INVALID');
  }

  private device(request: FastifyRequest) {
    if (!isStaffOrigin(this.origin, request.headers.origin) || request.staffDevice === undefined)
      throw new ApiError('FORBIDDEN');
    if (!this.enabled) throw new ApiError('NOT_READY');
    return request.staffDevice;
  }
}
