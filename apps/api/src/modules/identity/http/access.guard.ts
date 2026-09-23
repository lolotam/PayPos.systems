import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { ApiError } from '../../../shared/errors.ts';
import { PUBLIC_ROUTE } from '../../../shared/public.decorator.ts';
import { AuthorizePlatform } from '../use-cases/authorize-platform/authorize-platform.ts';
import { AuthorizeRequest } from '../use-cases/authorize-request/authorize-request.ts';
import { CheckFeature } from '../use-cases/check-feature/check-feature.ts';
import {
  AUTHENTICATED_ONLY,
  REQUIRE_ACCESS,
  REQUIRE_PLATFORM,
  REQUIRES_FEATURE,
  type RequiredAccess,
} from '../../../shared/access.decorators.ts';

/** The header a client uses to ask for a company; the session's own hint is the fallback. */
export const COMPANY_HEADER = 'x-company-id';

/**
 * The second global guard (ADR-0003 §4, path A). A route marked @Require is authorized by the AuthorizeRequest use
 * case — membership in the requested company first, before any tenant query, then the permission at the route's
 * target with DENY winning. Every refusal is the same 403, so it is no oracle for what exists. A non-public route
 * without @Require or @Authenticated is refused too (and createApp will not start with one, or with a conflict).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  readonly #reflector: Reflector;
  readonly #authorize: AuthorizeRequest | null;
  readonly #authorizePlatform = new AuthorizePlatform();

  constructor(
    @Inject(Reflector) reflector: Reflector,
    @Inject(AuthorizeRequest) authorize: AuthorizeRequest | null,
  ) {
    this.#reflector = reflector;
    this.#authorize = authorize;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const platform = this.#reflector.get<string | undefined>(REQUIRE_PLATFORM, handler);
    if (platform !== undefined) {
      const grants = context.switchToHttp().getRequest<FastifyRequest>().principal?.grants ?? [];
      if (this.#authorizePlatform.execute(grants, platform)) return true;
      throw new ApiError('FORBIDDEN');
    }
    const required = this.#reflector.get<RequiredAccess | undefined>(REQUIRE_ACCESS, handler);
    // @Require is never skipped: a public or session-only marker next to it is rejected at startup, and a
    // permission, when present, is always checked.
    if (required === undefined) {
      const open = [PUBLIC_ROUTE, AUTHENTICATED_ONLY].some(
        (marker) =>
          this.#reflector.getAllAndOverride<boolean | undefined>(marker, [
            handler,
            context.getClass(),
          ]) === true,
      );
      if (open) return true;
      throw new ApiError('FORBIDDEN');
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const principal = request.principal;
    const userId = principal?.userId ?? null;
    if (principal === undefined || userId === null || this.#authorize === null) {
      throw new ApiError('FORBIDDEN');
    }
    const header = request.headers[COMPANY_HEADER];
    const params = (request.params ?? {}) as Record<string, unknown>;
    const authorized = await this.#authorize.execute({
      userId,
      requestedCompany: header === undefined ? request.companyHint : header,
      permission: required.permission,
      ...(required.target.business === undefined
        ? {}
        : { businessParam: params[required.target.business] ?? null }),
      ...(required.target.branch === undefined
        ? {}
        : { branchParam: params[required.target.branch] ?? null }),
    });
    if (authorized === null) throw new ApiError('FORBIDDEN');
    request.principal = {
      ...principal,
      companyId: authorized.companyId,
      memberships: authorized.memberships.map((m) => ({ companyId: authorized.companyId, ...m })),
      // The platform grants the session guard resolved stay beside the company's.
      grants: [
        ...principal.grants.filter((g) => g.source === 'platform'),
        ...authorized.grants.map((g) => ({ ...g })),
      ],
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
  readonly #checkFeature: CheckFeature | null;

  constructor(
    @Inject(Reflector) reflector: Reflector,
    @Inject(CheckFeature) checkFeature: CheckFeature | null,
  ) {
    this.#reflector = reflector;
    this.#checkFeature = checkFeature;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flag = this.#reflector.get<string | undefined>(REQUIRES_FEATURE, context.getHandler());
    if (flag === undefined) return true;
    const companyId = context.switchToHttp().getRequest<FastifyRequest>().principal?.companyId;
    if (companyId === null || companyId === undefined || this.#checkFeature === null) {
      throw new ApiError('FORBIDDEN');
    }
    if (!(await this.#checkFeature.execute(companyId, flag))) {
      throw new ApiError('FEATURE_DISABLED');
    }
    return true;
  }
}
