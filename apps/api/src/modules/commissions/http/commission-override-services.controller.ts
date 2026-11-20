import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import {
  commissionOverrideServiceListQuery,
  id,
  type CommissionOverrideServiceList,
  type CommissionOverrideServiceListQuery,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { listCommissionOverrideServices } from '../queries/commission-override-services.query.ts';
import {
  COMMISSION_SERVICE_OVERRIDE_LIST_READS,
  CommissionServiceOverrideReadError,
  type CommissionServiceOverrideListReadsFactory,
} from '../queries/commission-service-overrides.query.ts';

function mapReadError(error: unknown): never {
  if (error instanceof CommissionServiceOverrideReadError) throw new ApiError(error.code);
  throw error;
}

@Controller('businesses/:businessId/employees/:employeeId/commission-override-services')
export class CommissionOverrideServicesController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(COMMISSION_SERVICE_OVERRIDE_LIST_READS)
    private readonly listReads: CommissionServiceOverrideListReadsFactory,
  ) {}

  @Get()
  @Require('manage:commission-plans:business', { business: 'businessId' })
  @RequiresFeature('commissions')
  async listServices(
    @Param('businessId', new ZodValidationPipe(id.toLowerCase())) businessId: string,
    @Param('employeeId', new ZodValidationPipe(id.toLowerCase())) employeeId: string,
    @Query(new ZodValidationPipe(commissionOverrideServiceListQuery))
    query: CommissionOverrideServiceListQuery,
    @Req() request: FastifyRequest,
  ): Promise<CommissionOverrideServiceList> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    try {
      return await this.database.withTenant(
        actor.companyId,
        (tx) =>
          listCommissionOverrideServices(tx, this.listReads(tx), {
            companyId: actor.companyId,
            userId: actor.userId,
            businessId,
            employeeId,
          }, query),
        { userId: actor.userId },
      );
    } catch (error) {
      return mapReadError(error);
    }
  }
}
