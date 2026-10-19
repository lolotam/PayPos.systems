import { Controller, Get, Inject, Req } from '@nestjs/common';
import { id, type MyMembershipsResponse, type MyWorkspacesResponse } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { myMemberships } from '../queries/my-memberships.query.ts';
import { myWorkspaces, type WorkspaceNames } from '../queries/my-workspaces.query.ts';

export const WORKSPACE_NAMES = Symbol('WORKSPACE_NAMES');

@Controller()
export class MeController {
  readonly #db: TenantWrappers | null;
  readonly #names: WorkspaceNames | null;

  constructor(
    @Inject(DATABASE) db: TenantWrappers | null,
    @Inject(WORKSPACE_NAMES) names: WorkspaceNames | null,
  ) {
    this.#db = db;
    this.#names = names;
  }

  // Session only: the rows are the caller's own memberships, checked inside withUser and withTenant.
  @Get('me/workspaces')
  @Authenticated()
  async workspaces(@Req() request: FastifyRequest): Promise<MyWorkspacesResponse> {
    if (this.#db === null || this.#names === null) throw new ApiError('NOT_READY');
    const userId = request.principal?.userId;
    if (userId === null || userId === undefined) throw new ApiError('FORBIDDEN');
    return myWorkspaces(this.#db, this.#names, userId);
  }

  // AccessGuard لا يقرأ x-company-id إلا مع @Require؛ التحقق هنا عشان الجلسة بس تكفي.
  @Get('me/memberships')
  @Authenticated()
  async memberships(@Req() request: FastifyRequest): Promise<MyMembershipsResponse> {
    if (this.#db === null || this.#names === null) throw new ApiError('NOT_READY');
    const userId = request.principal?.userId;
    if (userId === null || userId === undefined) throw new ApiError('FORBIDDEN');
    return myMemberships(this.#db, this.#names, userId, companyHeader(request));
  }
}

function companyHeader(request: FastifyRequest): string {
  const parsed = id.safeParse(request.headers['x-company-id']);
  if (!parsed.success) throw new ApiError('BAD_REQUEST');
  return parsed.data.toLowerCase();
}
