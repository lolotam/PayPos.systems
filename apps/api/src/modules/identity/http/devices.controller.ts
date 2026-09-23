import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import {
  claimDeviceInput,
  registerDeviceInput,
  type ClaimDeviceInput,
  type DeviceRegistration,
  type DeviceToken,
  type PairingCode,
  type RegisterDeviceInput,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Authenticated, Require } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { RATE_LIMITER } from '../../../shared/device-authenticator.ts';
import { ApiError } from '../../../shared/errors.ts';
import type { RateLimiter } from '../../../shared/ports/rate-limiter.port.ts';
import { Public } from '../../../shared/public.decorator.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  DeviceNotPendingError,
  type ApproveDevice,
} from '../use-cases/approve-device/approve-device.ts';
import type { ClaimDeviceToken } from '../use-cases/claim-device-token/claim-device-token.ts';
import type { IssuePairingCode } from '../use-cases/issue-pairing-code/issue-pairing-code.ts';
import {
  PairingCodeInvalidError,
  type RegisterDevice,
} from '../use-cases/register-device/register-device.ts';
import {
  DeviceNotFoundError,
  type RevokeDevice,
} from '../use-cases/revoke-device/revoke-device.ts';

// TODO(spec): the public device routes' rate limit — ADR-0003 §6 requires one, no value is decided; 10 per minute
// per client address until it is.
const PUBLIC_LIMIT = 10;
const PUBLIC_WINDOW_SECONDS = 60;

export interface DeviceUseCases {
  readonly issuePairingCode: IssuePairingCode;
  readonly registerDevice: RegisterDevice;
  readonly approveDevice: ApproveDevice;
  readonly claimDeviceToken: ClaimDeviceToken;
  readonly revokeDevice: RevokeDevice;
}
export const DEVICE_USE_CASES = Symbol('DEVICE_USE_CASES');

const uuid = (value: string) => value.toLowerCase();

@Controller()
export class DevicesController {
  readonly #devices: DeviceUseCases | null;
  readonly #limiter: RateLimiter | null;

  constructor(
    @Inject(DEVICE_USE_CASES) devices: DeviceUseCases | null,
    @Inject(RATE_LIMITER) limiter: RateLimiter | null,
  ) {
    this.#devices = devices;
    this.#limiter = limiter;
  }

  #ready(): DeviceUseCases {
    if (this.#devices === null) throw new ApiError('NOT_READY');
    return this.#devices;
  }

  async #limit(route: string, request: FastifyRequest): Promise<void> {
    if (this.#limiter === null) throw new ApiError('NOT_READY');
    const key = `${route}:${request.ip}`;
    if (!(await this.#limiter.hit(key, PUBLIC_LIMIT, PUBLIC_WINDOW_SECONDS))) {
      throw new ApiError('TOO_MANY_REQUESTS');
    }
  }

  @Post('branches/:branchId/devices/pairing-code')
  @Require('manage:devices:branch', { branch: 'branchId' })
  async pairingCode(
    @Param('branchId') branchId: string,
    @Req() request: FastifyRequest,
  ): Promise<PairingCode> {
    const issued = await this.#ready().issuePairingCode.execute({
      ...actorOf(request),
      branchId: uuid(branchId),
    });
    return { code: issued.code, expires_at: issued.expiresAt.toISOString() };
  }

  @Post('devices/register')
  @Public()
  async register(
    @Body(new ZodValidationPipe(registerDeviceInput)) input: RegisterDeviceInput,
    @Req() request: FastifyRequest,
  ): Promise<DeviceRegistration> {
    await this.#limit('device-register', request);
    try {
      const registered = await this.#ready().registerDevice.execute({
        code: input.pairing_code,
        label: input.label,
        fingerprint: input.device_fingerprint ?? null,
        appVersion: input.app_version ?? null,
      });
      return {
        company_id: registered.companyId,
        device_id: registered.deviceId,
        claim_secret: registered.claimSecret,
      };
    } catch (error) {
      if (error instanceof PairingCodeInvalidError) throw new ApiError('PAIRING_CODE_INVALID');
      throw error;
    }
  }

  @Post('devices/claim')
  @Public()
  @HttpCode(200)
  async claim(
    @Body(new ZodValidationPipe(claimDeviceInput)) input: ClaimDeviceInput,
    @Req() request: FastifyRequest,
  ): Promise<DeviceToken> {
    await this.#limit('device-claim', request);
    const outcome = await this.#ready().claimDeviceToken.execute({
      companyId: input.company_id,
      deviceId: input.device_id,
      claimSecret: input.claim_secret,
    });
    if (outcome.kind === 'pending') throw new ApiError('DEVICE_PENDING');
    if (outcome.kind === 'refused') throw new ApiError('UNAUTHENTICATED');
    return { device_token: outcome.token };
  }

  @Post('branches/:branchId/devices/:deviceId/approve')
  @Require('manage:devices:branch', { branch: 'branchId' })
  @HttpCode(204)
  async approve(
    @Param('branchId') branchId: string,
    @Param('deviceId') deviceId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    try {
      await this.#ready().approveDevice.execute({
        ...actorOf(request),
        branchId: uuid(branchId),
        deviceId: uuid(deviceId),
      });
    } catch (error) {
      if (error instanceof DeviceNotPendingError) throw new ApiError('DEVICE_NOT_PENDING');
      throw error;
    }
  }

  @Post('branches/:branchId/devices/:deviceId/revoke')
  @Require('manage:devices:branch', { branch: 'branchId' })
  @HttpCode(204)
  async revoke(
    @Param('branchId') branchId: string,
    @Param('deviceId') deviceId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    try {
      await this.#ready().revokeDevice.execute({
        ...actorOf(request),
        branchId: uuid(branchId),
        deviceId: uuid(deviceId),
      });
    } catch (error) {
      if (error instanceof DeviceNotFoundError) throw new ApiError('NOT_FOUND');
      throw error;
    }
  }

  // A device asks who it is — the first call of every POS start, and how a revoked device learns it (plan T9b).
  @Get('devices/me')
  @Authenticated()
  me(@Req() request: FastifyRequest): { device_id: string; company_id: string; branch_id: string } {
    const principal = request.principal;
    const branch = principal?.memberships[0];
    if (principal?.kind !== 'device' || principal.deviceId === null || branch === undefined) {
      throw new ApiError('FORBIDDEN');
    }
    return {
      device_id: principal.deviceId,
      company_id: branch.companyId,
      branch_id: branch.scopeId,
    };
  }
}
