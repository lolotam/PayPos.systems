import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
import { id } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import {
  IDENTITY_CAPABILITY_ACCESS,
  deniedIdentityCapability,
  readIdentityCapability,
  type IdentityCapabilityAccess,
} from '../queries/identity-capability.query.ts';
import { IdentityCapabilityCompanyGuard } from './identity-capability-company.guard.ts';

@Controller('businesses/:businessId/settings/identity-capability')
export class IdentityCapabilityController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(IDENTITY_CAPABILITY_ACCESS) private readonly access: IdentityCapabilityAccess | null,
  ) {}

  @Get()
  @Authenticated()
  @UseGuards(IdentityCapabilityCompanyGuard)
  async read(
    @Param('businessId', new ZodValidationPipe(id)) businessId: string,
    @Req() request: FastifyRequest,
  ) {
    if (request.principal?.kind === 'device') return deniedIdentityCapability();
    if (this.database === null || this.access === null) throw new ApiError('NOT_READY');
    const actor = actorOf(request);
    const access = this.access;
    return this.database.withTenant(
      actor.companyId,
      (tx) => readIdentityCapability(tx, actor.companyId, actor.userId, businessId, access),
      { userId: actor.userId },
    );
  }
}
