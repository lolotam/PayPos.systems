import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import {
  setImportedRefundsInput,
  type ImportedRefundsResponse,
  type SetImportedRefundsInput,
} from '@pospay/contracts';
import type { FastifyRequest } from 'fastify';

import { Require } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import type { SetImportedRefunds } from '../use-cases/set-imported-refunds/set-imported-refunds.ts';

// القراءة والكتابة كلهم بمزود واحد مسلك من أسلاك الموديول: المتحكم رفيع وما يعرفش TenantWrappers.
export interface ImportedRefundsWiring {
  readonly set: SetImportedRefunds;
  readonly read: (companyId: string, userId: string, businessId: string) => Promise<ImportedRefundsResponse>;
}
export const IMPORTED_REFUNDS_WIRING = Symbol('IMPORTED_REFUNDS_WIRING');

// شاشة مفتاح مرتجع الباقات المستوردة لوحدها؛ settings.controller مش بيكبر.
@Controller()
export class ImportedRefundsController {
  readonly #wiring: ImportedRefundsWiring | null;

  constructor(@Inject(IMPORTED_REFUNDS_WIRING) wiring: ImportedRefundsWiring | null) {
    this.#wiring = wiring;
  }

  @Get('businesses/:businessId/settings/imported-refunds')
  @Require('manage:imported-refunds:business', { business: 'businessId' })
  async read(
    @Param('businessId') businessId: string,
    @Req() request: FastifyRequest,
  ): Promise<ImportedRefundsResponse> {
    if (this.#wiring === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    return this.#wiring.read(actor.companyId, actor.userId, businessId.toLowerCase());
  }

  @Put('businesses/:businessId/settings/imported-refunds')
  @HttpCode(200)
  @Require('manage:imported-refunds:business', { business: 'businessId' })
  async set(
    @Param('businessId') businessId: string,
    @Body(new ZodValidationPipe(setImportedRefundsInput)) input: SetImportedRefundsInput,
    @Req() request: FastifyRequest,
  ): Promise<ImportedRefundsResponse> {
    if (this.#wiring === null) throw new ApiError('NOT_READY');
    return this.#wiring.set.execute(actorOf(request), businessId.toLowerCase(), input);
  }
}
