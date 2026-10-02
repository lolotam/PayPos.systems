import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  SetMetadata,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { STAFF_AUTH_BODY_BYTES } from '../../../shared/staff-input-limits.ts';
import { OTP_LIFETIME_MS, OTP_RETRY_MS, type StaffOtpApi, type StaffSessions } from '@pospay/auth';
import {
  staffOtpRequestInput,
  staffOtpVerifyInput,
  type StaffOtpRequestInput,
  type StaffOtpVerifyInput,
  type StaffSessionContext,
} from '@pospay/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { STAFF_ROUTE } from '../../../shared/staff-authentication.ts';
import { toWebHeaders } from '../../../shared/web-headers.ts';

export const STAFF_OTP_API = Symbol('STAFF_OTP_API');
export const STAFF_SESSIONS = Symbol('STAFF_SESSIONS');
export const STAFF_POS_ORIGIN = Symbol('STAFF_POS_ORIGIN');

@Controller('devices/me')
export class StaffOtpController {
  constructor(
    @Inject(STAFF_OTP_API) private readonly otp: StaffOtpApi | null,
    @Inject(STAFF_SESSIONS) private readonly sessions: StaffSessions | null,
    @Inject(STAFF_POS_ORIGIN) private readonly origin: string | null,
  ) {}

  @Post('staff-otp/request')
  @RouteConfig({ bodyLimit: STAFF_AUTH_BODY_BYTES })
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'device')
  @HttpCode(202)
  async request(
    @Body(new ZodValidationPipe(staffOtpRequestInput)) input: StaffOtpRequestInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (this.otp === null || request.staffDevice === undefined)
      throw new ApiError('OTP_UNAVAILABLE');
    this.validate(request);
    const result = await this.otp.request({
      ...input,
      ip: request.ip,
      device: request.staffDevice,
    });
    if (result.kind === 'unavailable') throw new ApiError('OTP_UNAVAILABLE');
    if (result.kind === 'limited') {
      void reply.header('retry-after', result.retryAfter);
      throw new ApiError('TOO_MANY_REQUESTS');
    }
    return {
      status: 'ACCEPTED',
      challenge_id: result.challengeId,
      expires_in: OTP_LIFETIME_MS / 1000,
      retry_after: OTP_RETRY_MS / 1000,
      recovery: 'ASK_MANAGER',
    };
  }

  @Post('staff-otp/verify')
  @RouteConfig({ bodyLimit: STAFF_AUTH_BODY_BYTES })
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'device')
  @HttpCode(200)
  async verify(
    @Body(new ZodValidationPipe(staffOtpVerifyInput)) input: StaffOtpVerifyInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StaffSessionContext> {
    if (this.otp === null || request.staffDevice === undefined)
      throw new ApiError('OTP_UNAVAILABLE');
    this.validate(request);
    const result = await this.otp.verify({
      challengeId: input.challenge_id,
      code: input.code,
      ip: request.ip,
      device: request.staffDevice,
    });
    if (result.kind === 'unavailable') throw new ApiError('OTP_UNAVAILABLE');
    if (result.kind === 'limited') {
      void reply.header('retry-after', result.retryAfter);
      throw new ApiError('TOO_MANY_REQUESTS');
    }
    if (result.kind !== 'verified') throw new ApiError('OTP_INVALID');
    void reply.header('set-cookie', result.cookie);
    return contextResponse(result.session);
  }

  @Get('staff-session')
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'staff')
  session(@Req() request: FastifyRequest): StaffSessionContext {
    this.validate(request);
    if (request.staffSession === undefined) throw new ApiError('UNAUTHENTICATED');
    return contextResponse(request.staffSession);
  }

  @Post('staff-session/sign-out')
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'staff')
  @HttpCode(200)
  async signOut(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.validate(request);
    if (this.sessions === null || request.staffDevice === undefined)
      throw new ApiError('UNAUTHENTICATED');
    void reply.header(
      'set-cookie',
      await this.sessions.signOut(toWebHeaders(request), request.staffDevice),
    );
    return { status: 'SIGNED_OUT' };
  }

  private validate(request: FastifyRequest): void {
    if (this.origin === null || request.headers.origin !== this.origin)
      throw new ApiError('FORBIDDEN');
    if (request.principal?.kind !== 'device' && request.staffSession === undefined)
      throw new ApiError('FORBIDDEN');
  }
}

function contextResponse(
  session: NonNullable<FastifyRequest['staffSession']>,
): StaffSessionContext {
  return {
    user_id: session.userId,
    company_id: session.context.companyId,
    business_id: session.context.businessId,
    branch_id: session.context.branchId,
    device_id: session.context.deviceId,
    expires_at: session.deadline.toISOString(),
  };
}
