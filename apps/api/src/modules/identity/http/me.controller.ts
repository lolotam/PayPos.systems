import { Body, Controller, Get, Header, Inject, Put, Req } from '@nestjs/common';
import {
  id,
  setMyPreferencesInput,
  type MyMembershipsResponse,
  type MyPreferencesResponse,
  type MyWorkspacesResponse,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import type { FastifyRequest } from 'fastify';

import { Authenticated } from '../../../shared/access.decorators.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { ApiError } from '../../../shared/errors.ts';
import { myMemberships } from '../queries/my-memberships.query.ts';
import { myPreferences, type MyPreferencesReader } from '../queries/my-preferences.query.ts';
import { myWorkspaces, type WorkspaceNames } from '../queries/my-workspaces.query.ts';
import { SetMyPreferences } from '../use-cases/set-my-preferences/set-my-preferences.ts';

export const WORKSPACE_NAMES = Symbol('WORKSPACE_NAMES');
export const MY_PREFERENCES = Symbol('MY_PREFERENCES');
/** علامة قدرة شريحة 076: مقروءة مرة واحدة عند الإقلاع، وبترد في قراءة مساحات العمل. */
export const STAFF_ACCESS_CAPABILITY = Symbol('STAFF_ACCESS_CAPABILITY');

@Controller()
export class MeController {
  readonly #db: TenantWrappers | null;
  readonly #names: WorkspaceNames | null;
  readonly #staffAccess: boolean;

  constructor(
    @Inject(DATABASE) db: TenantWrappers | null,
    @Inject(WORKSPACE_NAMES) names: WorkspaceNames | null,
    @Inject(MY_PREFERENCES) private readonly preferences: MyPreferencesReader | null,
    @Inject(SetMyPreferences) private readonly setPreferences: SetMyPreferences | null,
    @Inject(STAFF_ACCESS_CAPABILITY) staffAccess: boolean,
  ) {
    this.#db = db;
    this.#names = names;
    this.#staffAccess = staffAccess;
  }

  @Get('me/preferences')
  @Authenticated()
  @Header('Cache-Control', 'private, no-store')
  async preferencesForCaller(@Req() request: FastifyRequest): Promise<MyPreferencesResponse> {
    const userId = preferenceUserId(request);
    if (this.preferences === null) throw new ApiError('NOT_READY');
    return myPreferences(this.preferences, userId);
  }

  @Put('me/preferences')
  @Authenticated()
  async setPreferencesForCaller(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): Promise<MyPreferencesResponse> {
    const userId = preferenceUserId(request);
    if (this.setPreferences === null) throw new ApiError('NOT_READY');
    const parsed = setMyPreferencesInput.safeParse(body);
    if (!parsed.success) throw new ApiError('VALIDATION_FAILED');
    return this.setPreferences.execute(userId, parsed.data);
  }

  // Session only: the rows are the caller's own memberships, checked inside withUser and withTenant.
  @Get('me/workspaces')
  @Authenticated()
  async workspaces(@Req() request: FastifyRequest): Promise<MyWorkspacesResponse> {
    if (this.#db === null || this.#names === null) throw new ApiError('NOT_READY');
    const userId = request.principal?.userId;
    if (userId === null || userId === undefined) throw new ApiError('FORBIDDEN');
    const workspaces = await myWorkspaces(this.#db, this.#names, userId);
    return { ...workspaces, capabilities: { staff_access: this.#staffAccess } };
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

function preferenceUserId(request: FastifyRequest): string {
  const userId = request.principal?.userId;
  if (userId === null || userId === undefined) throw new ApiError('FORBIDDEN');
  return userId;
}

function companyHeader(request: FastifyRequest): string {
  const parsed = id.safeParse(request.headers['x-company-id']);
  if (!parsed.success) throw new ApiError('BAD_REQUEST');
  return parsed.data.toLowerCase();
}
