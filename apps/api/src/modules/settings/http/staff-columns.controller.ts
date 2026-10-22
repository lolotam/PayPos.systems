import { Body, Controller, Get, Inject, Param, Put, Req } from '@nestjs/common';
import {
  replaceStaffColumnsInput,
  type ReplaceStaffColumnsInput,
  type StaffColumnsSettings,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require, RequireAny } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { Idempotency, type IdempotencyInput } from '../../../shared/idempotency.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { storedStaffColumnsQuery } from '../queries/staff-columns.query.ts';
import { ReplaceStaffColumns } from '../use-cases/replace-staff-columns/replace-staff-columns.ts';
import { staffColumnsView } from '../use-cases/staff-columns-view/staff-columns-view.ts';

@Controller('businesses/:businessId/settings/staff-columns')
export class StaffColumnsController {
  constructor(
    @Inject(ReplaceStaffColumns) private readonly replace: ReplaceStaffColumns | null,
    @Inject(DATABASE) private readonly db: TenantWrappers | null,
  ) {}

  @Get()
  // القراءة مقبولة بصلاحية القراءة أو بصلاحية أعمدة تطبيق الموظفين (MY-Q10، PP-27.1، MY-Q5 أبو سالم).
  @RequireAny(['read:settings:business', 'manage:staff-app-columns:business'], {
    business: 'businessId',
  })
  async read(
    @Param('businessId') businessId: string,
    @Req() request: FastifyRequest,
  ): Promise<StaffColumnsSettings> {
    if (this.db === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const business = businessId.toLowerCase();
    const stored = await this.db.withTenant(
      actor.companyId,
      (tx) => storedStaffColumnsQuery(tx, actor.companyId, business),
      { userId: actor.userId },
    );
    return staffColumnsView(business, stored);
  }

  @Put()
  @Require('manage:staff-app-columns:business', { business: 'businessId' })
  async save(
    @Param('businessId') businessId: string,
    @Body(new ZodValidationPipe(replaceStaffColumnsInput)) input: ReplaceStaffColumnsInput,
    @Idempotency() idem: IdempotencyInput,
    @Req() request: FastifyRequest,
  ): Promise<StaffColumnsSettings> {
    if (this.replace === null) throw new ApiError('NOT_READY');
    return this.replace.execute({
      ...actorOf(request),
      ...idem,
      businessId: businessId.toLowerCase(),
      input,
    });
  }
}
