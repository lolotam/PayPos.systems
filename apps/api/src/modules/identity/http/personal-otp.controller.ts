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
import { OTP_LIFETIME_MS, OTP_RETRY_MS } from '@pospay/auth';
import {
  personalOtpRequestInput,
  personalOtpVerifyInput,
  type PersonalOtpRequestInput,
  type PersonalOtpVerifyInput,
} from '@pospay/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { Public } from '../../../shared/public.decorator.ts';
import {
  PERSONAL_AUTHENTICATION,
  PERSONAL_ROUTE,
  type PersonalAuthentication,
} from '../../../shared/personal-authentication.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { toWebHeaders } from '../../../shared/web-headers.ts';

@Controller('staff')
export class PersonalOtpController {
  constructor(
    @Inject(PERSONAL_AUTHENTICATION) private readonly auth: PersonalAuthentication | null,
  ) {}

  @Post('personal-otp/request')
  @Public()
  @HttpCode(202)
  @RouteConfig({ bodyLimit: 1024 })
  async request(
    @Body(new ZodValidationPipe(personalOtpRequestInput)) input: PersonalOtpRequestInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const auth = this.validate(request);
    const result = await auth.otp.request({
      phone: input.phone,
      locale: input.locale,
      ip: request.ip,
      device: {
        purpose: 'STAFF_PERSONAL',
        companyId: input.company_id,
        businessId: input.business_id,
      },
    });
    this.rate(result, reply);
    if (result.kind !== 'accepted') throw new ApiError('OTP_UNAVAILABLE');
    return {
      status: 'ACCEPTED',
      challenge_id: result.challengeId,
      expires_in: OTP_LIFETIME_MS / 1000,
      retry_after: OTP_RETRY_MS / 1000,
      recovery: 'ASK_MANAGER',
    };
  }

  @Post('personal-otp/verify')
  @Public()
  @HttpCode(200)
  @RouteConfig({ bodyLimit: 1024 })
  async verify(
    @Body(new ZodValidationPipe(personalOtpVerifyInput)) input: PersonalOtpVerifyInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const auth = this.validate(request);
    const result = await auth.otp.verify({
      challengeId: input.challenge_id,
      code: input.code,
      ip: request.ip,
      device: {
        purpose: 'STAFF_PERSONAL',
        companyId: input.company_id,
        businessId: input.business_id,
      },
    });
    this.rate(result, reply);
    if (result.kind !== 'verified') throw new ApiError('OTP_INVALID');
    const employeeId = await auth.eligibility.employee(
      result.session.userId,
      result.session.context,
    );
    if (employeeId === null) throw new ApiError('OTP_INVALID');
    void reply.header('set-cookie', result.cookie);
    return {
      company_id: result.session.context.companyId,
      business_id: result.session.context.businessId,
      user_id: result.session.userId,
      employee_id: employeeId,
      expires_at: result.session.deadline.toISOString(),
    };
  }

  @Get('personal-session')
  @Authenticated()
  @SetMetadata(PERSONAL_ROUTE, true)
  session(@Req() request: FastifyRequest) {
    const session = request.personalSession;
    if (session === undefined) throw new ApiError('UNAUTHENTICATED');
    return {
      company_id: session.context.companyId,
      business_id: session.context.businessId,
      user_id: session.userId,
      employee_id: request.personalEmployeeId,
      expires_at: session.deadline.toISOString(),
    };
  }

  @Post('personal-session/sign-out')
  @Authenticated()
  @SetMetadata(PERSONAL_ROUTE, true)
  @HttpCode(200)
  async signOut(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    if (this.auth === null) throw new ApiError('UNAUTHENTICATED');
    void reply.header('set-cookie', await this.auth.sessions.signOut(toWebHeaders(request)));
    return { status: 'SIGNED_OUT' };
  }

  private validate(request: FastifyRequest) {
    if (this.auth === null || this.auth.otp === null) throw new ApiError('OTP_UNAVAILABLE');
    if (
      this.auth.origin === null ||
      request.headers.origin !== this.auth.origin ||
      request.headers.authorization !== undefined
    )
      throw new ApiError('FORBIDDEN');
    return { ...this.auth, otp: this.auth.otp };
  }
  private rate(result: { kind: string; retryAfter?: number }, reply: FastifyReply) {
    if (result.kind === 'unavailable') throw new ApiError('OTP_UNAVAILABLE');
    if (result.kind === 'limited') {
      void reply.header('retry-after', result.retryAfter);
      throw new ApiError('TOO_MANY_REQUESTS');
    }
  }
}
