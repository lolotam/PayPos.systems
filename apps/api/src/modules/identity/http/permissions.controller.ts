import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  id,
  membershipPageQuery,
  permissionOverrideInput,
  type PageQuery,
  type PermissionOverrideInput,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Require } from '../../../shared/access.decorators.ts';
import { actorOf } from '../../../shared/actor.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { getMembershipPermissions } from '../queries/membership-permissions.query.ts';
import { listPermissionMemberships } from '../queries/permission-memberships.query.ts';
import { GrantPermissionOverride } from '../use-cases/grant-permission-override/grant-permission-override.ts';

@Controller('permissions/memberships')
export class PermissionsController {
  constructor(
    @Inject(DATABASE) private readonly database: TenantWrappers | null,
    @Inject(GrantPermissionOverride) private readonly grant: GrantPermissionOverride | null,
  ) {}

  @Get()
  @Require('read:memberships:company')
  async list(
    @Query(new ZodValidationPipe(membershipPageQuery)) page: PageQuery,
    @Req() request: FastifyRequest,
  ) {
    if (this.database === null) throw new ApiError('NOT_READY');
    return listPermissionMemberships(this.database, actorOf(request), page);
  }

  @Get(':membershipId')
  @Require('read:memberships:company')
  async detail(
    @Param('membershipId', new ZodValidationPipe(id)) membershipId: string,
    @Query(new ZodValidationPipe(membershipPageQuery)) page: PageQuery,
    @Req() request: FastifyRequest,
  ) {
    if (this.database === null) throw new ApiError('NOT_READY');
    const result = await getMembershipPermissions(
      this.database,
      actorOf(request),
      membershipId,
      page,
      this.grant?.editingEnabled ?? false,
    );
    if (result === null) throw new ApiError('NOT_FOUND');
    return result;
  }

  @Post(':membershipId/overrides')
  @Require('manage:memberships:company')
  async create(
    @Param('membershipId', new ZodValidationPipe(id)) membershipId: string,
    @Body(new ZodValidationPipe(permissionOverrideInput)) terms: PermissionOverrideInput,
    @Req() request: FastifyRequest,
  ) {
    if (this.grant === null) throw new ApiError('NOT_READY');
    return this.grant.execute(actorOf(request), membershipId, terms);
  }
}
