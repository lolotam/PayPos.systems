import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  updateBusinessSettingsInput,
  updateBusinessIdentityNamesInput,
  setBusinessLogoInput,
  discountLimitInput,
  type DiscountLimitInput,
  type DiscountLimit,
  type BusinessIdentity,
  type BusinessIdentityNames,
  type BusinessLogo,
  type BusinessSettings,
  type SetBusinessLogoInput,
  type UpdateBusinessIdentityNamesInput,
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
  BUSINESS_IDENTITY_READER,
  businessIdentityQuery,
  type BusinessIdentityReader,
} from '../queries/business-identity.query.ts';
import {
  businessSettingsQuery,
  type SettingsReadCache,
  type SettingsTemplate,
} from '../queries/business-settings.query.ts';
import type { UpdateBusinessSettings } from '../use-cases/update-business-settings/update-business-settings.ts';
import type { UpdateBusinessIdentityNames } from '../use-cases/update-business-identity-names/update-business-identity-names.ts';
import type { SetBusinessLogo } from '../use-cases/set-business-logo/set-business-logo.ts';
import type { SetBusinessDiscountDefault } from '../use-cases/set-business-discount-default/set-business-discount-default.ts';

export interface SettingsWiring {
  readonly discount: SetBusinessDiscountDefault;
  readonly update: UpdateBusinessSettings;
  readonly identity: UpdateBusinessIdentityNames;
  readonly logo: SetBusinessLogo;
  readonly cache: SettingsReadCache;
  readonly template: SettingsTemplate;
}
export const SETTINGS_WIRING = Symbol('SETTINGS_WIRING');

@Controller()
export class SettingsController {
  readonly #wiring: SettingsWiring | null;
  readonly #db: TenantWrappers | null;
  readonly #identity: BusinessIdentityReader | null;

  constructor(
    @Inject(SETTINGS_WIRING) wiring: SettingsWiring | null,
    @Inject(DATABASE) db: TenantWrappers | null,
    @Inject(BUSINESS_IDENTITY_READER) identity: BusinessIdentityReader | null,
  ) {
    this.#wiring = wiring;
    this.#db = db;
    this.#identity = identity;
  }

  @Post('businesses/:businessId/settings/discount-limit')
  @HttpCode(200)
  @Require('manage:settings:business', { business: 'businessId' })
  async setDiscount(
    @Param('businessId') businessId: string,
    @Body(new ZodValidationPipe(discountLimitInput)) input: DiscountLimitInput,
    @Req() request: FastifyRequest,
  ): Promise<DiscountLimit> {
    if (this.#wiring === null) throw new ApiError('NOT_READY');
    return this.#wiring.discount.execute(actorOf(request), businessId.toLowerCase(), input);
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

  @Get('businesses/:businessId/settings/identity')
  @Require('manage:business-identity:business', { business: 'businessId' })
  async readIdentity(
    @Param('businessId') businessId: string,
    @Req() request: FastifyRequest,
  ): Promise<BusinessIdentity> {
    if (this.#db === null || this.#identity === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const reader = this.#identity;
    return this.#db.withTenant(
      actor.companyId,
      (tx) => businessIdentityQuery(tx, actor.companyId, businessId.toLowerCase(), reader),
      { userId: actor.userId },
    );
  }

  @Patch('businesses/:businessId/settings/identity')
  @HttpCode(200)
  @Require('manage:business-identity:business', { business: 'businessId' })
  async updateIdentity(
    @Param('businessId') businessId: string,
    @Body(new ZodValidationPipe(updateBusinessIdentityNamesInput))
    input: UpdateBusinessIdentityNamesInput,
    @Req() request: FastifyRequest,
  ): Promise<BusinessIdentityNames> {
    if (this.#wiring === null) throw new ApiError('NOT_READY');
    return this.#wiring.identity.execute(actorOf(request), businessId.toLowerCase(), input);
  }

  @Put('businesses/:businessId/settings/logo')
  @HttpCode(200)
  @Require('manage:business-identity:business', { business: 'businessId' })
  async setLogo(
    @Param('businessId') businessId: string,
    @Body(new ZodValidationPipe(setBusinessLogoInput)) input: SetBusinessLogoInput,
    @Req() request: FastifyRequest,
  ): Promise<BusinessLogo> {
    if (this.#wiring === null) throw new ApiError('NOT_READY');
    return this.#wiring.logo.execute(actorOf(request), businessId.toLowerCase(), input);
  }
}
