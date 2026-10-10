import { Body, Controller, Get, HttpCode, Inject, Post, Req, SetMetadata } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import {
  passkeyVerifyInput,
  passkeyOptionsInput,
  type PasskeyOptionsInput,
  type PasskeyVerifyInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { PERSONAL_ROUTE } from '../../../shared/personal-authentication.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { bindingStatus } from '../queries/passkey-binding.query.ts';
import {
  EnrolPasskey,
  PasskeyBindingError,
  type PasskeyScope,
} from '../use-cases/enrol-passkey/enrol-passkey.ts';

export const PASSKEY_OPTIONS = Symbol('PASSKEY_OPTIONS');
export interface RegistrationOptionsPort {
  enrollmentOptions(scope: PasskeyScope): Promise<{ challengeId: string; options: unknown }>;
}

@Controller('staff/passkey')
export class PasskeysController {
  constructor(
    @Inject(EnrolPasskey) private readonly enrol: EnrolPasskey | null,
    @Inject(PASSKEY_OPTIONS) private readonly options: RegistrationOptionsPort | null,
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
  ) {}

  @Get()
  @Authenticated()
  @SetMetadata(PERSONAL_ROUTE, true)
  status(@Req() request: FastifyRequest) {
    const scope = scopeOf(request);
    if (this.database === null) throw new ApiError('NOT_READY');
    return this.database.withTenant(
      scope.companyId,
      (tx) => bindingStatus(tx, scope.companyId, scope.employeeId),
      { userId: scope.userId },
    );
  }

  @Post('options')
  @Authenticated()
  @SetMetadata(PERSONAL_ROUTE, true)
  @HttpCode(200)
  async registrationOptions(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(passkeyOptionsInput)) input: PasskeyOptionsInput,
  ) {
    if (this.options === null || this.enrol === null) throw new ApiError('NOT_READY');
    try {
      if (input.installation_id !== undefined)
        await this.enrol.checkInstallation(scopeOf(request), input.installation_id);
    } catch (error) {
      if (error instanceof PasskeyBindingError) throw new ApiError(error.code);
      throw error;
    }
    if ((await this.status(request)).bound) throw new ApiError('PASSKEY_ALREADY_BOUND');
    const generated = await this.options.enrollmentOptions(scopeOf(request));
    return { challenge_id: generated.challengeId, options: generated.options };
  }

  @Post('verify')
  @Authenticated()
  @SetMetadata(PERSONAL_ROUTE, true)
  @HttpCode(201)
  @RouteConfig({ bodyLimit: 196608 })
  async verify(
    @Body(new ZodValidationPipe(passkeyVerifyInput)) input: PasskeyVerifyInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.enrol === null) throw new ApiError('NOT_READY');
    if ((await this.status(request)).bound) throw new ApiError('PASSKEY_ALREADY_BOUND');
    try {
      return await this.enrol.execute(
        scopeOf(request),
        input.challenge_id,
        input.response,
        input.installation_id,
      );
    } catch (error) {
      if (error instanceof PasskeyBindingError) throw new ApiError(error.code);
      throw error;
    }
  }
}

function scopeOf(request: FastifyRequest): PasskeyScope {
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
