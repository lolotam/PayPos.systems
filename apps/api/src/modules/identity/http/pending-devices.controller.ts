import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import {
  id,
  pendingDevicesQuery,
  type PendingDevicesQuery,
  type PendingDevicesResponse,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { listPendingDevices } from '../queries/pending-devices.query.ts';

@Controller('branches/:branchId/devices')
export class PendingDevicesController {
  constructor(@Inject(DATABASE) private readonly database: TenantWrappers | null) {}

  // الـ status بيتأكد من قيمته بس (FR-003): القائمة دي للـ PENDING بس، فمفيش حاجة تتبعت للقراءة.
  @Get()
  @Require('manage:devices:branch', { branch: 'branchId' })
  async list(
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Query(new ZodValidationPipe(pendingDevicesQuery)) _query: PendingDevicesQuery,
    @Req() request: FastifyRequest,
  ): Promise<PendingDevicesResponse> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    return this.database.withTenant(
      actor.companyId,
      (tx) => listPendingDevices(tx, actor.companyId, branchId),
      { userId: actor.userId },
    );
  }
}
