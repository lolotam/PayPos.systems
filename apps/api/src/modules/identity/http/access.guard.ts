import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { ApiError } from '../../../shared/errors.ts';
import { PUBLIC_ROUTE } from '../../../shared/public.decorator.ts';
import { evaluateAccess, type AccessTarget } from '../domain/access.ts';
import type { AccessReader } from '../ports/access-reader.port.ts';
import {
  AUTHENTICATED_ONLY,
  REQUIRE_ACCESS,
  REQUIRES_FEATURE,
  type AccessTargetParams,
  type RequiredAccess,
} from './access.decorators.ts';

export const ACCESS_READER = Symbol('ACCESS_READER');
/** The header a client uses to ask for a company; the session's own hint is the fallback. */
export const COMPANY_HEADER = 'x-company-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Anything that is not one well-formed UUID is refused as if the company were not the caller's — the answer
// never reveals whether the id exists.
const asUuid = (value: unknown): string | null =>
  typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;

function requestedCompany(request: FastifyRequest): string | null {
  const header = request.headers[COMPANY_HEADER];
  return header === undefined ? asUuid(request.companyHint) : asUuid(header);
}

async function resolveTarget(
  reader: AccessReader,
  companyId: string,
  params: AccessTargetParams,
  values: Record<string, unknown>,
): Promise<AccessTarget | null> {
  if (params.branch !== undefined) {
    const branchId = asUuid(values[params.branch]);
    if (branchId === null) return null;
    // The branch's business comes from the database, inside the verified company — never from the client.
    const businessId = await reader.businessOfBranch(companyId, branchId);
    return businessId === null ? null : { companyId, businessId, branchId };
  }
  if (params.business !== undefined) {
    const businessId = asUuid(values[params.business]);
    return businessId === null ? null : { companyId, businessId };
  }
  return { companyId };
}

/**
 * The second global guard (ADR-0003 §4, path A). After the session guard, a route marked @Require resolves the
 * requested company, refuses it unless the caller has an active membership there — before any tenant query —
 * then evaluates the permission at the route's target with DENY winning. Every refusal is the same 403, so it is
 * no oracle for which companies, businesses or branches exist. A non-public route without @Require or
 * @Authenticated is refused too (and createApp will not start with one).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  readonly #reflector: Reflector;
  readonly #reader: AccessReader | null;

  constructor(
    @Inject(Reflector) reflector: Reflector,
    @Inject(ACCESS_READER) reader: AccessReader | null,
  ) {
    this.#reflector = reflector;
    this.#reader = reader;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.#reflector.getAllAndOverride<boolean | undefined>(PUBLIC_ROUTE, targets) === true) {
      return true;
    }
    if (
      this.#reflector.get<boolean | undefined>(AUTHENTICATED_ONLY, context.getHandler()) === true
    ) {
      return true;
    }
    const required = this.#reflector.get<RequiredAccess | undefined>(
      REQUIRE_ACCESS,
      context.getHandler(),
    );
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const principal = request.principal;
    const userId = principal?.userId ?? null;
    const companyId = requestedCompany(request);
    const reader = this.#reader;
    if (
      required === undefined ||
      principal === undefined ||
      userId === null ||
      companyId === null ||
      reader === null
    ) {
      throw new ApiError('FORBIDDEN');
    }
    if (!(await reader.companiesOf(userId)).includes(companyId)) throw new ApiError('FORBIDDEN');
    const params = (request.params ?? {}) as Record<string, unknown>;
    const target = await resolveTarget(reader, companyId, required.target, params);
    if (target === null) throw new ApiError('FORBIDDEN');
    const access = await reader.accessIn(companyId, userId);
    if (!evaluateAccess(access.grants, required.permission, target))
      throw new ApiError('FORBIDDEN');
    request.principal = {
      ...principal,
      companyId,
      memberships: access.memberships.map((m) => ({ companyId, ...m })),
      grants: access.grants.map((g) => ({ ...g })),
    };
    return true;
  }
}

/**
 * The third global guard: a route marked @RequiresFeature runs only when the feature is enabled for the company
 * the access guard verified (09 §12). A disabled feature is FEATURE_DISABLED, so a client can tell it from a
 * missing permission.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  readonly #reflector: Reflector;
  readonly #reader: AccessReader | null;

  constructor(
    @Inject(Reflector) reflector: Reflector,
    @Inject(ACCESS_READER) reader: AccessReader | null,
  ) {
    this.#reflector = reflector;
    this.#reader = reader;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flag = this.#reflector.get<string | undefined>(REQUIRES_FEATURE, context.getHandler());
    if (flag === undefined) return true;
    const companyId = context.switchToHttp().getRequest<FastifyRequest>().principal?.companyId;
    if (companyId === null || companyId === undefined || this.#reader === null) {
      throw new ApiError('FORBIDDEN');
    }
    if (!(await this.#reader.isFeatureEnabled(companyId, flag))) {
      throw new ApiError('FEATURE_DISABLED');
    }
    return true;
  }
}
