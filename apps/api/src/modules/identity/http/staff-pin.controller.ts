import { Body, Controller, HttpCode, Inject, Post, Req, Res, SetMetadata } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { STAFF_AUTH_BODY_BYTES } from '../../../shared/staff-input-limits.ts';
import {
  changeTemporaryStaffPinInput,
  staffPinInput,
  staffPinResetInput,
  type ChangeTemporaryStaffPinInput,
  type StaffPinInput,
  type StaffPinResetInput,
  type StaffSessionContext,
} from '@pospay/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Authenticated, Require } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { STAFF_ROUTE } from '../../../shared/staff-authentication.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { StaffPinError } from '../use-cases/staff-pin-error.ts';
import type { ChangeTemporaryStaffPin } from '../use-cases/change-temporary-staff-pin/change-temporary-staff-pin.ts';
import type { SignInStaffPin } from '../use-cases/sign-in-staff-pin/sign-in-staff-pin.ts';
import type { ResetStaffPin } from '../use-cases/reset-staff-pin/reset-staff-pin.ts';
import {
  isStaffOrigin,
  STAFF_POS_ORIGIN,
  type StaffOrigins,
} from '../../../shared/staff-origin.token.ts';

export const STAFF_PIN_USE_CASES = Symbol('STAFF_PIN_USE_CASES');
/** بوابة تغيير الرقم السري المؤقت: مقفولة مع شجرة 076 كلها لحد ما الشريحة تفتح (FR-F1-9). */
export const STAFF_PIN_CHANGE_ENABLED = Symbol('STAFF_PIN_CHANGE_ENABLED');
export interface StaffPinUseCases {
  readonly signIn: SignInStaffPin;
  readonly reset: ResetStaffPin;
  readonly change: ChangeTemporaryStaffPin;
}

@Controller()
export class StaffPinController {
  constructor(
    @Inject(STAFF_PIN_USE_CASES) private readonly pins: StaffPinUseCases | null,
    @Inject(STAFF_POS_ORIGIN) private readonly origin: StaffOrigins | null,
    @Inject(STAFF_PIN_CHANGE_ENABLED) private readonly enabled: boolean,
  ) {}

  @Post('devices/me/staff-pin/sign-in')
  @RouteConfig({ bodyLimit: STAFF_AUTH_BODY_BYTES })
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'device')
  @HttpCode(200)
  async signIn(
    @Body(new ZodValidationPipe(staffPinInput)) input: StaffPinInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StaffSessionContext> {
    if (!isStaffOrigin(this.origin, request.headers.origin) || request.staffDevice === undefined)
      throw new ApiError('FORBIDDEN');
    if (this.pins === null) throw new ApiError('NOT_READY');
    const issued = await this.pins.signIn
      .execute({ ...input, device: request.staffDevice })
      .catch((error: unknown) => {
        // رفض معروف من الـuse case: رقم مؤقت محتاج تغيير، أو مدته خلصت.
        if (error instanceof StaffPinError)
          throw new ApiError(
            error.code,
            error.code === 'PIN_CHANGE_REQUIRED' && error.proof !== undefined
              ? { proof: error.proof }
              : undefined,
          );
        request.log.warn(
          { capability: 'STAFF_PIN', state: 'UNAVAILABLE', reason: 'OPERATION_FAILED' },
          'staff OTP capability',
        );
        throw new ApiError('NOT_READY');
      });
    if (issued === null) throw new ApiError('PIN_INVALID');
    void reply.header('set-cookie', issued.cookie);
    const s = issued.session;
    return {
      user_id: s.userId,
      company_id: s.context.companyId,
      business_id: s.context.businessId,
      branch_id: s.context.branchId,
      device_id: s.context.deviceId,
      expires_at: s.deadline.toISOString(),
    };
  }

  @Post('devices/me/staff-pin/change')
  @RouteConfig({ bodyLimit: STAFF_AUTH_BODY_BYTES })
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'device')
  @HttpCode(204)
  async change(
    @Body(new ZodValidationPipe(changeTemporaryStaffPinInput)) input: ChangeTemporaryStaffPinInput,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    if (!isStaffOrigin(this.origin, request.headers.origin) || request.staffDevice === undefined)
      throw new ApiError('FORBIDDEN');
    if (!this.enabled) throw new ApiError('NOT_READY');
    if (this.pins === null) throw new ApiError('NOT_READY');
    const outcome = await this.pins.change.execute({ ...input, device: request.staffDevice });
    if (outcome.kind === 'changed') return;
    if (outcome.kind === 'expired') throw new ApiError('PIN_EXPIRED');
    if (outcome.kind === 'locked') throw new ApiError('PIN_LOCKED');
    throw new ApiError('PIN_INVALID');
  }

  @Post('staff-pins/reset')
  @Require('manage:memberships:company')
  @HttpCode(204)
  async reset(
    @Body(new ZodValidationPipe(staffPinResetInput)) input: StaffPinResetInput,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const actor = actorOf(request);
    if (request.principal?.kind !== 'user') throw new ApiError('FORBIDDEN');
    if (this.pins === null) throw new ApiError('NOT_READY');
    if (
      !(await this.pins.reset.execute({
        companyId: actor.companyId,
        actor: actor.userId,
        target: input.user_id,
        pin: input.pin,
      }))
    )
      throw new ApiError('FORBIDDEN');
  }
}
