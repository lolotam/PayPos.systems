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
import { listPendingDevices, PendingDevicesCursorError } from '../queries/pending-devices.query.ts';

@Controller('branches/:branchId/devices')
export class PendingDevicesController {
  constructor(@Inject(DATABASE) private readonly database: TenantWrappers | null) {}

  // الـ status لازم يكون 'pending' (FR-003): الـ pipe بيرفض غيره بـ 400 قبل أي قراءة.
  @Get()
  @Require('manage:devices:branch', { branch: 'branchId' })
  async list(
    @Param('branchId', new ZodValidationPipe(id)) branchId: string,
    @Query(new ZodValidationPipe(pendingDevicesQuery)) query: PendingDevicesQuery,
    @Req() request: FastifyRequest,
  ): Promise<PendingDevicesResponse> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    try {
      return await this.database.withTenant(
        actor.companyId,
        (tx) => listPendingDevices(tx, actor.companyId, branchId, query),
        { userId: actor.userId },
      );
    } catch (error) {
      // المؤشر الغلط أو بتاع فرع تاني: 400 زي أي طلب مرفوض.
      if (error instanceof PendingDevicesCursorError) throw new ApiError('VALIDATION_FAILED');
      throw error;
    }
  }
}
