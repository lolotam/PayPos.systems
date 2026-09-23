import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import {
  verifyCashierPinInput,
  type CashierPinVerified,
  type VerifyCashierPinInput,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import type { SetCashierPin } from '../use-cases/set-cashier-pin/set-cashier-pin.ts';
import type { VerifyCashierPin } from '../use-cases/verify-cashier-pin/verify-cashier-pin.ts';

// set-cashier-pin has no route yet: PINs belong to employees, and until staff exists (Phase 1) only test fixtures get
// one (ADR-0003 §4.2).
export interface CashierPinUseCases {
  readonly setCashierPin: SetCashierPin;
  readonly verifyCashierPin: VerifyCashierPin;
}
export const CASHIER_PIN_USE_CASES = Symbol('CASHIER_PIN_USE_CASES');

@Controller()
export class CashierPinsController {
  readonly #pins: CashierPinUseCases | null;

  constructor(@Inject(CASHIER_PIN_USE_CASES) pins: CashierPinUseCases | null) {
    this.#pins = pins;
  }

  // Only an approved device asks — a PIN proves who is at its till, and never opens app. (ADR-0003 §4 path B).
  @Post('devices/me/cashier-pin/verify')
  @Authenticated()
  @HttpCode(200)
  async verify(
    @Body(new ZodValidationPipe(verifyCashierPinInput)) input: VerifyCashierPinInput,
    @Req() request: FastifyRequest,
  ): Promise<CashierPinVerified> {
    const principal = request.principal;
    const companyId = principal?.memberships[0]?.companyId;
    if (principal?.kind !== 'device' || companyId === undefined) throw new ApiError('FORBIDDEN');
    if (this.#pins === null) throw new ApiError('NOT_READY');
    const outcome = await this.#pins.verifyCashierPin.execute({
      companyId,
      employeeId: input.employee_id,
      pin: input.pin,
    });
    if (outcome.kind === 'locked') throw new ApiError('PIN_LOCKED');
    if (outcome.kind === 'busy') throw new ApiError('TOO_MANY_REQUESTS');
    if (outcome.kind === 'refused') throw new ApiError('PIN_INVALID');
    return { employee_id: outcome.employeeId };
  }
}
