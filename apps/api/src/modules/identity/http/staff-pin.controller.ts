import { Body, Controller, HttpCode, Inject, Post, Req, Res, SetMetadata } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import {
  staffPinInput,
  staffPinResetInput,
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
import type { SignInStaffPin } from '../use-cases/sign-in-staff-pin/sign-in-staff-pin.ts';
import type { ResetStaffPin } from '../use-cases/reset-staff-pin/reset-staff-pin.ts';
import { STAFF_POS_ORIGIN } from './staff-otp.controller.ts';

export const STAFF_PIN_USE_CASES = Symbol('STAFF_PIN_USE_CASES');
export interface StaffPinUseCases {
  readonly signIn: SignInStaffPin;
  readonly reset: ResetStaffPin;
}

@Controller()
export class StaffPinController {
  constructor(
    @Inject(STAFF_PIN_USE_CASES) private readonly pins: StaffPinUseCases | null,
    @Inject(STAFF_POS_ORIGIN) private readonly origin: string | null,
  ) {}

  @Post('devices/me/staff-pin/sign-in')
  @RouteConfig({ bodyLimit: 1024 })
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'device')
  @HttpCode(200)
  async signIn(
    @Body(new ZodValidationPipe(staffPinInput)) input: StaffPinInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StaffSessionContext> {
    if (
      this.origin === null ||
      request.headers.origin !== this.origin ||
      request.staffDevice === undefined
    )
      throw new ApiError('FORBIDDEN');
    if (this.pins === null) throw new ApiError('NOT_READY');
    const issued = await this.pins.signIn
      .execute({ ...input, device: request.staffDevice })
      .catch(() => null);
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
