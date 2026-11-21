import { Body, Controller, Get, HttpCode, Inject, Param, Put, Req } from '@nestjs/common';
import {
  importedRefundsResponse,
  setImportedRefundsInput,
  type ImportedRefundsResponse,
  type SetImportedRefundsInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { importedRefundsQuery } from '../queries/imported-refunds.query.ts';
import type { SetImportedRefunds } from '../use-cases/set-imported-refunds/set-imported-refunds.ts';

export interface ImportedRefundsWiring {
  readonly set: SetImportedRefunds;
}
export const IMPORTED_REFUNDS_WIRING = Symbol('IMPORTED_REFUNDS_WIRING');

// شاشة مفتاح مرتجع الباقات المستوردة لوحدها؛ settings.controller مش بيكبر.
@Controller()
export class ImportedRefundsController {
  readonly #wiring: ImportedRefundsWiring | null;
  readonly #db: TenantWrappers | null;

  constructor(
    @Inject(IMPORTED_REFUNDS_WIRING) wiring: ImportedRefundsWiring | null,
    @Inject(DATABASE) db: TenantWrappers | null,
  ) {
    this.#wiring = wiring;
    this.#db = db;
  }

  @Get('businesses/:businessId/settings/imported-refunds')
  @Require('manage:imported-refunds:business', { business: 'businessId' })
  async read(
    @Param('businessId') businessId: string,
    @Req() request: FastifyRequest,
  ): Promise<ImportedRefundsResponse> {
    if (this.#db === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    return importedRefundsResponse.parse(
      await this.#db.withTenant(
        actor.companyId,
        (tx) => importedRefundsQuery(tx, actor.companyId, businessId.toLowerCase()),
        { userId: actor.userId },
      ),
    );
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
