import { SetMetadata } from '@nestjs/common';
import type { FeatureFlag, Permission } from '@pospay/db';

import { targetFitsPermission } from '../use-cases/authorize-request/authorize-request.ts';

export const REQUIRE_ACCESS = 'pospay:require-access';
export const AUTHENTICATED_ONLY = 'pospay:authenticated-only';
export const REQUIRES_FEATURE = 'pospay:requires-feature';

/**
 * Where the guard finds the business or branch a route touches: the name of a route parameter. The company
 * always comes from the verified membership, never from here.
 */
export interface AccessTargetParams {
  readonly business?: string;
  readonly branch?: string;
}

export interface RequiredAccess {
  readonly permission: Permission;
  readonly target: AccessTargetParams;
}

/**
 * Guards a route with one permission (ADR-0003 §4): the caller needs an active membership in the requested
 * company, and a grant covering the target with no DENY covering it. The permission's scope names the target
 * the route must declare — a `:branch` permission needs `{ branch: '<param>' }`, a `:business` one
 * `{ business: '<param>' }`, a `:company` one nothing. A mismatch fails when the module loads, not at request time.
 *
 * @param permission the catalogued 'action:resource:scope' permission
 * @param target     the route parameters naming the business or branch, when the scope needs one
 * @returns the metadata decorator
 */
export function Require(permission: Permission, target: AccessTargetParams = {}): MethodDecorator {
  const expected = targetFitsPermission(permission, {
    business: target.business !== undefined,
    branch: target.branch !== undefined,
  });
  if (!expected) {
    throw new TypeError(`@Require('${permission}') needs exactly the target its scope names`);
  }
  return SetMetadata(REQUIRE_ACCESS, { permission, target } satisfies RequiredAccess);
}

/**
 * A route that needs a verified session and nothing else — it touches no company's data (who am I, which
 * companies can I switch to). Anything that reads or writes tenant data uses @Require instead.
 *
 * @returns the metadata decorator
 */
export const Authenticated = (): MethodDecorator => SetMetadata(AUTHENTICATED_ONLY, true);

/**
 * Refuses the route unless the feature is enabled for the verified company: an unexpired per-company
 * override if there is one, otherwise the plan's flag (SPEC §4). Runs after @Require, which resolves the company.
 *
 * @param flag the module's feature flag (FEATURE_FLAGS in @pospay/db)
 * @returns the metadata decorator
 */
export const RequiresFeature = (flag: FeatureFlag): MethodDecorator =>
  SetMetadata(REQUIRES_FEATURE, flag);
