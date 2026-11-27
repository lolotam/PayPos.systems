import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  PASSWORD_RESET_LIFETIME_MS,
  PASSWORD_RESET_RETRY_MS,
  type PasswordResetOtpApi,
} from '@pospay/auth';
import {
  passwordResetOtpRequestInput,
  passwordResetOtpResetInput,
  type PasswordResetOtpRequestInput,
  type PasswordResetOtpResetInput,
  type PasswordResetOtpResult,
} from '@pospay/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../../../shared/errors.ts';
import { Public } from '../../../shared/public.decorator.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';

export const PASSWORD_RESET_OTP_API = Symbol('PASSWORD_RESET_OTP_API');
export const PASSWORD_RESET_ORIGINS = Symbol('PASSWORD_RESET_ORIGINS');

/**
 * مسارا استرجاع كلمة المرور بكود الإيميل (spec 079 PR-b). عامّان بلا جلسة: الحماية بأصل المتصفح الموثوق
 * وحدود Redis قبل أي قراءة. المسار أخصّ من `/v1/auth/*` فـ Fastify بيوصّله هنا ومش لـ Better Auth.
 */
@Controller('auth/password-reset/otp')
export class PasswordResetOtpController {
  constructor(
    @Inject(PASSWORD_RESET_OTP_API) private readonly otp: PasswordResetOtpApi | null,
    @Inject(PASSWORD_RESET_ORIGINS) private readonly origins: readonly string[],
  ) {}

  @Post('request')
  @Public()
  @HttpCode(202)
  async request(
    @Body(new ZodValidationPipe(passwordResetOtpRequestInput)) input: PasswordResetOtpRequestInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const otp = this.ready(request);
    const result = await otp.request({ email: input.email, locale: input.locale, ip: request.ip });
    if (result.kind === 'unavailable') throw new ApiError('OTP_UNAVAILABLE');
    if (result.kind === 'limited') {
      void reply.header('retry-after', result.retryAfter);
      throw new ApiError('TOO_MANY_REQUESTS');
    }
    return {
      status: 'ACCEPTED',
      challenge_id: result.challengeId,
      expires_in: PASSWORD_RESET_LIFETIME_MS / 1000,
      retry_after: PASSWORD_RESET_RETRY_MS / 1000,
    };
  }

  @Post('reset')
  @Public()
  @HttpCode(200)
  async reset(
    @Body(new ZodValidationPipe(passwordResetOtpResetInput)) input: PasswordResetOtpResetInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PasswordResetOtpResult> {
    const otp = this.ready(request);
    const result = await otp.reset({
      challengeId: input.challenge_id,
      code: input.code,
      newPassword: input.new_password,
      ip: request.ip,
    });
    if (result.kind === 'unavailable') throw new ApiError('OTP_UNAVAILABLE');
    if (result.kind === 'limited') {
      void reply.header('retry-after', result.retryAfter);
      throw new ApiError('TOO_MANY_REQUESTS');
    }
    if (result.kind !== 'reset') throw new ApiError('OTP_INVALID');
    return { status: 'RESET' };
  }

  private ready(request: FastifyRequest): PasswordResetOtpApi {
    // الأصل بيتفحص قبل أي حد أو قراءة: طلب من أصل غير موثوق مايستهلكش حصة أحد.
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !this.origins.includes(origin))
      throw new ApiError('FORBIDDEN');
    if (this.otp === null) throw new ApiError('OTP_UNAVAILABLE');
    return this.otp;
  }
}
