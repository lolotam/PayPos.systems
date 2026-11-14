import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import { id, type ServiceCategoryClosingStatus } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { RequireAll, RequiresFeature } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { serviceCategoryClosingStatus } from '../queries/service-category-closing.query.ts';

// قرار SI-Q29 (PP-191): اللي يقدر يبدأ القفل يقدر يتابعه.
export const SERVICE_CATEGORY_CLOSING_STATUS_PERMISSIONS = [
  'manage:service-categories:business',
  'read:service-categories:business',
] as const;

@Controller('businesses/:businessId/service-categories/:categoryId/closings')
export class ServiceCategoryClosingsController {
  constructor(@Inject(DATABASE) private readonly database: TenantWrappers | null) {}

  @Get(':closingId')
  @RequireAll(SERVICE_CATEGORY_CLOSING_STATUS_PERMISSIONS, { business: 'businessId' })
  @RequiresFeature('catalog')
  async status(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Param('categoryId', new ZodValidationPipe(id)) categoryId: string,
    @Param('closingId', new ZodValidationPipe(id)) closingId: string,
    @Req() request: FastifyRequest,
  ): Promise<ServiceCategoryClosingStatus> {
    if (this.database === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const found = await this.database.withTenant(
      actor.companyId,
      (tx) => serviceCategoryClosingStatus(tx, actor.companyId, businessId, categoryId, closingId),
      { userId: actor.userId },
    );
    if (found === null) throw new ApiError('SERVICE_CATEGORY_CLOSING_NOT_FOUND');
    return found;
  }
}
