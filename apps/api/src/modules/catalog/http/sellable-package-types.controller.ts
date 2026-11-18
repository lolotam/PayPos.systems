import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  id,
  sellablePackageTypeListQuery,
  type SellablePackageTypeListQuery,
  type SellablePackageTypePage,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { SessionAdminGuard } from '../../../shared/session-admin.guard.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  listSellablePackageTypes,
  SELLABLE_PACKAGE_PLACE,
  type SellablePackagePlace,
} from '../queries/sellable-package-types.query.ts';

@Controller('businesses/:businessId/branches/:branchId/sellable-package-types')
export class SellablePackageTypesController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(SELLABLE_PACKAGE_PLACE) private readonly place: SellablePackagePlace | null,
  ) {}

  @Get()
  @Require('sell:packages:branch', { branch: 'branchId' })
  @RequiresFeature('orders')
  @UseGuards(SessionAdminGuard)
  async list(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('branchId', new ZodValidationPipe(id.toLowerCase())) branchId: string,
    @Query(new ZodValidationPipe(sellablePackageTypeListQuery)) query: SellablePackageTypeListQuery,
    @Req() request: FastifyRequest,
  ): Promise<SellablePackageTypePage> {
    if (this.database === null || this.place === null) throw new ApiError('NOT_READY');
    const database = this.database;
    const readPlace = this.place;
    const actor = actorOf(request);
    return database.withTenant(
      actor.companyId,
      async (tx) => {
        const place = await readPlace(tx, actor.companyId, businessId, branchId);
        if (place === null) throw new ApiError('FORBIDDEN');
        return listSellablePackageTypes(tx, actor.companyId, businessId, query);
      },
      { userId: actor.userId },
    );
  }
}
