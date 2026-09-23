import { Body, Controller, Get, Inject, Param, Patch, Req } from '@nestjs/common';
import {
  updateBusinessSettingsInput,
  type BusinessSettings,
  type UpdateBusinessSettingsInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  businessSettingsQuery,
  type SettingsReadCache,
  type SettingsTemplate,
} from '../queries/business-settings.query.ts';
import type { UpdateBusinessSettings } from '../use-cases/update-business-settings/update-business-settings.ts';

export interface SettingsWiring {
  readonly update: UpdateBusinessSettings;
  readonly cache: SettingsReadCache;
  readonly template: SettingsTemplate;
}
export const SETTINGS_WIRING = Symbol('SETTINGS_WIRING');

@Controller()
export class SettingsController {
  readonly #wiring: SettingsWiring | null;
  readonly #db: TenantWrappers | null;

  constructor(
    @Inject(SETTINGS_WIRING) wiring: SettingsWiring | null,
    @Inject(DATABASE) db: TenantWrappers | null,
  ) {
    this.#wiring = wiring;
    this.#db = db;
  }

  @Get('businesses/:businessId/settings')
  @Require('read:settings:business', { business: 'businessId' })
  async read(
    @Param('businessId') businessId: string,
    @Req() request: FastifyRequest,
  ): Promise<BusinessSettings> {
    if (this.#wiring === null || this.#db === null) throw new ApiError('NOT_READY');
    return businessSettingsQuery(
      this.#db,
      this.#wiring.cache,
      this.#wiring.template,
      actorOf(request),
      businessId.toLowerCase(),
    );
  }

  @Patch('businesses/:businessId/settings')
  @Require('manage:settings:business', { business: 'businessId' })
  async update(
    @Param('businessId') businessId: string,
    @Body(new ZodValidationPipe(updateBusinessSettingsInput)) input: UpdateBusinessSettingsInput,
    @Req() request: FastifyRequest,
  ): Promise<BusinessSettings> {
    if (this.#wiring === null) throw new ApiError('NOT_READY');
    return this.#wiring.update.execute({
      ...actorOf(request),
      businessId: businessId.toLowerCase(),
      change: {
        ...('default_language' in input ? { defaultLanguage: input.default_language ?? null } : {}),
        ...('calendar' in input ? { calendar: input.calendar ?? null } : {}),
      },
    });
  }
}
