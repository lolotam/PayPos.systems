import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { deliveryLogQuery, type DeliveryLogQuery } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  deliveryLogQueryResult,
  InvalidNotificationCursorError,
  type LogScope,
} from '../queries/delivery-log.query.ts';

@Controller()
export class NotificationsController {
  constructor(@Inject(DATABASE) readonly database: TenantWrappers | null) {}

  @Get('notifications/delivery-log')
  @Require('view:notifications:business')
  company(
    @Req() request: FastifyRequest,
    @Query(new ZodValidationPipe(deliveryLogQuery)) query: DeliveryLogQuery,
  ) {
    return this.read(request, query, {});
  }

  @Get('businesses/:businessId/notifications/delivery-log')
  @Require('view:notifications:business', { business: 'businessId' })
  business(
    @Param('businessId') businessId: string,
    @Req() request: FastifyRequest,
    @Query(new ZodValidationPipe(deliveryLogQuery)) query: DeliveryLogQuery,
  ) {
    return this.read(request, query, { businessId: businessId.toLowerCase() });
  }

  @Get('branches/:branchId/notifications/delivery-log')
  @Require('view:notifications:business', { branch: 'branchId' })
  branch(
    @Param('branchId') branchId: string,
    @Req() request: FastifyRequest,
    @Query(new ZodValidationPipe(deliveryLogQuery)) query: DeliveryLogQuery,
  ) {
    return this.read(request, query, { branchId: branchId.toLowerCase() });
  }

  private async read(request: FastifyRequest, query: DeliveryLogQuery, scope: LogScope) {
    if (this.database === null) throw new ApiError('NOT_READY');
    try {
      return await deliveryLogQueryResult(
        this.database,
        { ...actorOf(request), grants: request.principal?.grants ?? [] },
        scope,
        query,
      );
    } catch (error) {
      if (error instanceof InvalidNotificationCursorError) throw new ApiError('BAD_REQUEST');
      throw error;
    }
  }
}
