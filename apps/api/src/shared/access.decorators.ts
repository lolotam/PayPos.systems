import { SetMetadata } from '@nestjs/common';
import type { FeatureFlag, PlatformPermission, TenantPermission } from '@pospay/db';

// The access metadata every module's routes declare (ADR-0003 §4). It lives here, beside @Public, because any module
// may guard its routes and none may import identity (module-map.md §6); identity's guards read these keys.
export const REQUIRE_ACCESS = 'pospay:require-access';
export const AUTHENTICATED_ONLY = 'pospay:authenticated-only';
export const REQUIRES_FEATURE = 'pospay:requires-feature';
export const REQUIRE_PLATFORM = 'pospay:require-platform';

/**
 * Where the guard finds the business or branch a route touches: the name of a route parameter. The company
 * always comes from the verified membership, never from here.
 * Discount-limit administration may name a membership parameter; identity resolves its scope inside the verified company.
 */
export interface AccessTargetParams {
  readonly business?: string;
  readonly branch?: string;
  readonly membership?: string;
}

export interface RequiredAccess {
  readonly permission: TenantPermission;
  readonly target: AccessTargetParams;
}

/**
 * Guards a route with one permission (ADR-0003 §4): the caller needs an active membership in the requested
 * company, and a grant covering the target with no DENY covering it. The permission's scope names the target
 * the route must declare — a `:branch` permission needs `{ branch: '<param>' }`, a `:business` one
 * `{ business: '<param>' }`, a `:company` one nothing. A mismatch fails when the module loads.
 * Discount-limit administration also accepts `{ membership: '<param>' }` to authorize the membership's verified scope.
 *
 * @param permission the catalogued 'action:resource:scope' permission
 * @param target     the route parameters naming the business or branch, when the scope needs one
 * @returns the metadata decorator
 */
export function Require(
  permission: TenantPermission,
  target: AccessTargetParams = {},
): MethodDecorator {
  const scope = permission.split(':')[2];
  const business = target.business !== undefined;
  const branch = target.branch !== undefined;
  const membership = target.membership !== undefined;
  const expected =
    (permission === 'manage:discount-limits:business' && membership && !business && !branch) ||
    // ADR-0018: the same log permission is evaluated at the route's actual company/business/branch scope.
    (permission === 'view:notifications:business' && !(business && branch) && !membership) ||
    (scope === 'company' && !business && !branch && !membership) ||
    (scope === 'business' && business && !branch && !membership) ||
    (scope === 'branch' && branch && !business && !membership);
  if (!expected) {
    throw new TypeError(`@Require('${permission}') needs exactly the target its scope names`);
  }
  return SetMetadata(REQUIRE_ACCESS, { permission, target } satisfies RequiredAccess);
}

/**
 * A route that needs a verified session and nothing else — it touches no company's data (who am I, which
 * companies can I switch to). Personal tenant resources additionally use SelectedCompanyGuard and
 * filter every query/mutation by the session user (ADR-0018 §6); administrative access uses @Require.
 * Resources whose scope comes from a record use a dedicated guard after SelectedCompanyGuard; this marker alone
 * grants no resource access. The resource guard must still check effective permission and feature eligibility.
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

/**
 * Guards a platform-level route (ADR-0003 §3) — creating a company, for one — with a platform grant from
 * `platform_grants`, issued only by `pnpm platform:grant`. No company is resolved and no membership, role or
 * override can satisfy it.
 *
 * @param permission the catalogued ':platform' permission
 * @returns the metadata decorator
 */
export const RequirePlatform = (permission: PlatformPermission): MethodDecorator =>
  SetMetadata(REQUIRE_PLATFORM, permission);
