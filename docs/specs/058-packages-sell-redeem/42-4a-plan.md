# 42-4a — Any-of access guard: residual plan (TD-13, issue #506)

> **Status:** plan, documentation only · 2026-11-04 · base `main` at `f7b6f9ef`.
> **Spec:** [spec.md](spec.md) TD-13, CP-03, FR-070/FR-071 and the §7 row **42-4a**.
> **Implementer:** the PP-120 parent session implements this plan itself (Codex `sol`, effort medium). No model or lane
> change is part of this plan.
> **Scope guard:** no migration, no deploy, no contract or OpenAPI change, no `orders` file. 42-3 owns the sale route,
> domain and adapters; 43-1b owns the service-line guards; 42-4 owns the real FR-070/FR-071 routes.

## 1. What row 42-4a asked for, and what is already on `main`

`RequireAny` is **not** to be built again. PR #468 (57c-1, MY-Q10) delivered it, and #496 changed its first route's
second permission. The audit below maps each subtask of the §7 row to the code on `f7b6f9ef`.

| Row 42-4a item | State on `main` | Evidence |
|---|---|---|
| 1a. `RequireAny([…], target)` and the `RequiredAccess.permissions` list; `Require(p)` is the one-element case | **Done** | `apps/api/src/shared/access.decorators.ts` — `RequiredAccess.permissions`, `Require` → `RequireAny([permission], target)`, one `REQUIRE_ACCESS` key |
| 1b. A list of mixed scopes, an empty list and a wrong target fail when the module loads | **Done** | same file, `RequireAny` throws `TypeError` at decoration; `apps/api/src/shared/__tests__/require-any.spec.ts` (decoration runs when the controller class is defined, i.e. at module load) |
| 1c. `AccessGuard` passes the list to the identity authorizer | **Done** | `apps/api/src/modules/identity/http/access.guard.ts` — `permission: required.permissions` |
| 1d. The authorizer grants when one listed permission covers the target with no DENY **on that permission** | **Done in code, not tested** | `authorize-request.ts` — `permissions.some(p => permissionPossessionFailure(access.grants, p, …) === null)`; `permissionPossessionFailure` → `evaluateAccess(grants, permission, target)` filters grants by the one permission (`domain/permission-edit.ts`), so a DENY on A cannot refuse B |
| 1e. Every listed grant read in **one** `withTenant` transaction | **Partly.** Grants: one `accessIn` whatever the list length. **Target and grants: two separate `withTenant` transactions — issue #506, OPEN** | `persistence/access-reader.ts` — `businessOfBranch`, `businessInCompany`, `membershipTarget` and `accessIn` each open `db.withTenant`; ADR-0003 §6a 2026-10-21 names #506 |
| 2a. ADR-0003 §4 addendum | **Done** (to be amended, §4) | `docs/adr/0003-auth-rls-boundary.md` §6a, entry "2026-10-21, spec 058 TD-13 (first used by PR #468)" |
| 2b. `route-coverage.ts` and the startup checks see the new shape unchanged | **Done in code, not tested for `RequireAny`** | `identity/http/route-coverage.ts` counts `REQUIRE_ACCESS` presence, not its shape; `route-declarations.spec.ts` has no `RequireAny` case |
| 3a. Either permission alone → 200; neither → 403; a device → 403 | **Done at business scope only** | `settings/__tests__/staff-columns-read-access.spec.ts` (`read:settings:business` / `manage:staff-app-columns:business`) |
| 3b. The same at **branch** scope (the CP-03 shape) | **Missing** | no `RequireAny` route with a `{ branch }` target exists yet; 42-4 adds the first real one |
| 3c. The feature off → 403 | **Missing for `RequireAny`** | staff columns has no `@RequiresFeature`; `access-guard.spec.ts` "feature flags" covers `@Require` only |
| 3d. A list of mixed scopes refused at module load | **Done** | 1b |

**Residual work = issue #506 (target + grants plus the requested feature in one `withTenant`) + the test gaps 1d, 2b, 3b, 3c + the transaction
instrumentation.** The ADR addendum exists and is amended, not duplicated.

## 2. Transactions per guarded request, today and after

Path A (user session), counted per request from `authorize-request.ts` and `access-reader.ts`. All run one after another;
none is nested or concurrent today.

| Route target | Today | After 42-4a |
|---|---|---|
| company (`@Require('…:company')`) | `withUser` 1 (`companiesOf`) + `withTenant` 1 (`accessIn`) | unchanged: 1 + 1 |
| business (`{ business }`) | `withUser` 1 + `withTenant` **2** (`businessInCompany`, `accessIn`) | `withUser` 1 + `withTenant` **1** |
| branch (`{ branch }`, CP-03) | `withUser` 1 + `withTenant` **2** (`businessOfBranch`, `accessIn`) | `withUser` 1 + `withTenant` **1** |
| membership (`{ membership }`) | `withUser` 1 + `withTenant` **2** (`membershipTarget`, `accessIn`) | `withUser` 1 + `withTenant` **1** |
| `executeBranches` (attendance exceptions page) | `withUser` 1 + `withTenant` **2** (`businessesOfBranches`, `accessIn`) | `withUser` 1 + `withTenant` **1** (D-3) |
| `+ @RequiresFeature` | `FeatureGuard` adds `withTenant` 1, after `AccessGuard` | feature read shares the access `withTenant`; total 1 + 1 (D-2) |
| refused before the tenant (bad UUID / not a member) | 0 / `withUser` 1, **no** `withTenant` | unchanged |

`companiesOf` stays first, under `withUser`, so a non-member is still refused before any tenant context is set
(ADR-0003 §4, §4.1). Folding it into the same transaction through `withMember` is D-1.

## 3. Design

### 3.1 `AccessReader` port (`identity/ports/access-reader.port.ts`)

Add two methods, each with its one-line Arabic JSDoc (CLAUDE.md §3.1, `ports/**`):

```ts
/** What the route's parameters name, already parsed as UUIDs by the use case; nothing here is trusted yet. */
export type AccessTargetRequest =
  | { readonly kind: 'company' }
  | { readonly kind: 'business'; readonly businessId: string }
  | { readonly kind: 'branch'; readonly branchId: string }
  | { readonly kind: 'membership'; readonly membershipId: string };

accessAt(
  companyId: string,
  userId: string,
  request: AccessTargetRequest,
  featureFlag?: string,
): Promise<{ targets: ResolvedAccessTargets; access: CompanyAccess; feature?: { flag: string; enabled: boolean } } | null>;

accessAtBranches(
  companyId: string,
  userId: string,
  branchIds: readonly string[],
): Promise<{ businesses: ReadonlyMap<string, string>; access: CompanyAccess } | null>;
```

The English comment above is illustrative only: the real doc comments on `AccessTargetRequest` and on both methods are
in Arabic (CLAUDE.md §3.1). `CompanyAccess` is the existing `{ memberships; grants }` shape of `accessIn`, named once. `null` means the target is
unknown, foreign or (for branches) none of them is in the company: the use case refuses with the same 403.

Delete the port methods that lose their last production caller (D-4): `accessIn`, `businessOfBranch`,
`businessesOfBranches`, `businessInCompany`, `membershipTarget`. Keep `companiesOf` and `isFeatureEnabled`.
`readAccessTransaction` (the exported persistence helper the `*-access.ts` adapters call) keeps its behavior; its return type becomes `Promise<CompanyAccess>` so removal of `accessIn` leaves no dangling alias.

### 3.2 Persistence (`identity/persistence/access-reader.ts`)

- `accessAt`: one `db.withTenant(companyId, async (tx) => …, { userId })`. Inside it, resolve the target with the SQL the
  four old methods ran (lifted to private `tx`-level helpers; `readScopeTargets(tx, …)` already takes `tx`), return
  `null` **before** reading grants when the target is unknown or foreign, then `readAccessTransaction(tx, companyId,
  userId)`, and, when requested, `readFeatureEnabled(tx, companyId, featureFlag)` on that same transaction.
- `accessAtBranches`: the same, with the `businessesOfBranches` select; an empty map returns `null` without reading
  grants.
- No row lock is added: the guard's read stays a plain `SELECT` (the `accessIn` JSDoc rule).
- **Review check:** the target reads now run with `app.user_id` set as well as `app.company_id`. `branches` and
  `businesses` are tenant tables keyed on the company; the `memberships` select already filters
  `m.company_id = ${companyId}`. Confirm no RLS policy widens what these three selects return when `app.user_id` is set.

### 3.3 Use case (`identity/use-cases/authorize-request/authorize-request.ts`)

- `execute`: keep the order — parse the company UUID (refuse with no DB access), `companiesOf` (refuse with no tenant
  access), then parse the target parameters with `asUuid` and build one `AccessTargetRequest` (a malformed target
  parameter refuses without a tenant transaction, as today), then **one** `accessAt` call, then the existing
  `permissions.some(…)` evaluation, unchanged.
- `executeBranches`: keep the early return for an empty or all-invalid batch (no membership read), then `companiesOf`,
  then **one** `accessAtBranches`; the per-branch evaluation is unchanged.
- `Authorized` gains an optional server-read feature result; the branch map and public `shared/request-authorizer.ts` contract stay unchanged. `AccessGuard` passes the handler feature flag to the concrete authorizer and stores a successful result in a request-keyed WeakMap, bound to the verified company and exact flag. `FeatureGuard` consumes a matching result; a missing/mismatched result follows its existing `CheckFeature` fallback. No header/body value or process-wide authorization cache is accepted. Permission failure stays `FORBIDDEN` before an authorized disabled feature becomes `FEATURE_DISABLED`. `AccessGuard`'s device refusal
  (`userId === null` → 403 before the authorizer) and its company resolution do not change.

### 3.4 Docs

- **ADR-0003 §6a, the 2026-10-21 entry:** replace "merging the target and grants reads into one `withTenant`
  transaction is issue #506" with the fact that they now share one `withTenant` (and `executeBranches` likewise), keeping
  `companiesOf` under `withUser` first. Do not add a second addendum.
- **spec.md §7 row 42-4a:** no change to the row text; the PR description links this plan and states which items were
  already on `main` (§1).

## 4. Tests

### 4.1 New: `apps/api/src/modules/identity/__tests__/require-any-guard.spec.ts` (DB, HTTP)

A new file, because `access-guard.spec.ts` is 381 lines and `max-lines` errors at 400 (CLAUDE.md §3). Follow that
scope through the existing `permissionFixture({ controllers: [Probe] })`, with real sessions and its own cloned test
database. A counting `TenantWrappers` wrapper records calls to `withUser`, `withTenant`, `withMember` and
`withNewTenant`, maximum active count, user binding and SQL transaction identity for direct authorizer checks.
The wrapper lives in `identity/__tests__/access-transaction.fixture.ts`; the HTTP probe and cases remain together
under 300 lines. The CP-03 codes are seeded by `seedReferenceData` (`packages/db/src/seed.ts`,
`seedAccessCatalog`), so no manual `INSERT INTO permissions` is needed, unlike `access-guard.spec.ts`'s probe code.

Probe controller, using the real CP-03 pair (both codes are in `packages/db/src/access-catalog.ts`):

```ts
@RequireAny(['record:service-sessions:branch', 'read:service-sessions:branch'], { branch: 'branchId' })
@Get('branches/:branchId')            // no feature
@RequireAny([...the same pair], { branch: 'branchId' }) @RequiresFeature('orders')
@Get('branches/:branchId/orders')     // feature-gated
@Require('read:service-sessions:branch', { branch: 'branchId' })
@Get('single/branches/:branchId')     // single-permission regression lock
```

Members get a synthetic company-scoped role with no permissions plus explicit overrides, so the grants are exactly what
each case names (the `memberWith` pattern of `staff-columns-read-access.spec.ts`).

| # | Case | Expected |
|---|---|---|
| 1 | ALLOW `record:` only at the branch | 200 |
| 2 | ALLOW `read:` only at the branch | 200 |
| 3 | neither (an unrelated branch permission) | 403 `FORBIDDEN` |
| 4 | ALLOW `read:` + DENY `record:` at the branch | 200 — a DENY on one listed permission does not refuse the other (1d) |
| 5 | DENY on both at the branch, ALLOW on both business-wide | 403 at that branch; 200 at the sibling branch |
| 6 | another company's branch, an unknown branch, a malformed id | the same 403 `FORBIDDEN` |
| 7 | feature route, permission held, `orders` off by a company override | 403 `FEATURE_DISABLED` (match `access-guard.spec.ts` "feature flags") |
| 8 | feature route, no permission, `orders` off | 403 `FORBIDDEN` (`AccessGuard` runs first) |
| 9 | single-permission route, holder / non-holder | 200 / 403 — `Require` still the one-element case |

**Transaction instrumentation (the regression lock for #506):**

| # | Request | Expected counts |
|---|---|---|
| T1 | case 1 (granted, no feature) | `withUser` 1, `withTenant` 1, `withMember` 0, max open 1 — **was `withTenant` 2 before this PR** |
| T2 | case 7 route, feature on or off | `withUser` 1, `withTenant` 1 (target, grants, feature), max open 1 |
| T3 | case 6, foreign / unknown branch | `withUser` 1, `withTenant` 1, max open 1 |
| T4 | case 6, malformed id; and a non-member company | `withTenant` 0 |
| T5 | case 9 single-permission branch route | `withUser` 1, `withTenant` 1 |

Assert the counts per request (reset the counters before each `inject`), so T1 fails on today's code and passes after
§3 — run it once before the refactor to see it fail.

### 4.2 New: `apps/api/src/modules/identity/__tests__/require-any-declarations.spec.ts` (no DB)

- `assertEveryRouteGuarded` accepts a controller whose only marker is `@RequireAny([...], target)`.
- `@RequireAny` beside `@Authenticated()` on a method, and on a `@Public()` class, is reported `conflicting` (2b).
- `AccessGuard` with a `RequireAny` handler and a device principal (`kind: 'device'`, `userId: null`) throws
  `FORBIDDEN` and never calls the authorizer (a stub that fails the test if called) — the device case of 3a at the
  guard, independent of the business-scope HTTP proof already on `main`.

- Feature-sharing regression cases: matching company/flag avoids a second read; missing result, mismatched company or flag uses fallback; a new request cannot reuse another request's result. Non-permission routes keep fallback, disabled feature and null-dependency refusal behavior. Assert `FORBIDDEN` precedence when permission and feature both fail.

### 4.3 Existing tests to update (and nothing else)

| File | Change |
|---|---|
| `identity/__tests__/branch-access-batch.spec.ts` | the spies on `accessIn` / `businessesOfBranches` become one spy on `accessAtBranches` (called 1 when active, 0 for an empty batch); `companiesOf` spy and the parity assertions unchanged |
| `identity/__tests__/role-default-grants.spec.ts` (line ~346) | `accessIn(company, user)` → `accessAt(company, user, { kind: 'company' })`, reading `.access` |

### 4.4 Regressions that must stay green unchanged

`identity/__tests__/access-guard.spec.ts` (its "refused before `withTenant` is ever entered" and "DENY on branch 3"
cases are the single-permission locks), `deleted-company-guard.spec.ts`, `deleted-company-lock-race.spec.ts`
(`companyIsActive` still runs inside `readAccessTransaction`), `permission-holder-protection.spec.ts`,
`integrated-role-families.spec.ts`, `role-followups.spec.ts`, `role-policy-regressions.spec.ts`,
`permissions-screen.spec.ts`, `route-declarations.spec.ts`, `shared/__tests__/require-any.spec.ts`,
`settings/__tests__/staff-columns-read-access.spec.ts`, and the `executeBranches` / `REQUEST_AUTHORIZER` consumers:
`staff/__tests__/attendance-capabilities.spec.ts`, `staff/__tests__/attendance-actions-read-http.spec.ts`.

## 5. Gates

Locally (pipeline §6, PP-113): `pnpm typecheck`, `pnpm lint`, `pnpm lint:docs`, the boundaries check,
`pnpm module-map:check` (no arrow changes; it must still pass), and the specs of §4 on the worktree's own Postgres
container — never a shared or staging database. The full `pnpm check` and the API shards are decided by `ci-gate` on the
exact head. Guards: `clean-code-guard` (persistence, use case, port), `test-guard` (§4), `docs-guard` (ADR amendment).

## 6. Size

Original brief: **500–1000 changed lines**, including tests and documentation. Feature sharing and its tests are
included. Around 1600 is a scope-review caution only; **over 2000 stops for splitting**, per the original brief.

| File | Estimate |
|---|---|
| `ports/access-reader.port.ts` | +40 / −45 |
| `persistence/access-reader.ts` | +60 / −45 |
| `use-cases/authorize-request/authorize-request.ts` | +30 / −40 |
| `__tests__/access-transaction.fixture.ts` (new) | ≈ 150 |
| `__tests__/require-any-guard.spec.ts` (new) | ≈ 200 |
| `__tests__/require-any-declarations.spec.ts` (new) | ≈ 80 |
| `branch-access-batch.spec.ts`, `role-default-grants.spec.ts` | ≈ ±25 |
| `docs/adr/0003-auth-rls-boundary.md` | ≈ ±6 |

## 7. Settled technical directions

The manager personally reviewed the plan and current code at 23:43 Kuwait on 2026-11-04. These directions are settled; no new owner questions or follow-up issues are required.

- **D-1:** retain `companiesOf` under `withUser` before any tenant access; do not introduce `withMember`.
- **D-2:** include the requested feature read in the same adapter-owned access transaction. Carry only a server-created company/flag-bound request-local result, with existing fallback for missing/mismatched results and non-permission routes. Preserve error precedence and null-dependency refusal.
- **D-3:** include `executeBranches`, preserving empty/invalid input semantics and one access read for the batch.
- **D-4:** remove obsolete reader methods only after caller audit; update tests and the exported transaction helper's return-type alias, preserving its behavior and all external callers.

## 8. Evidence and verification

The parent independently read live issue #506: OPEN, requiring target and grants to share `withTenant(companyId, ..., { userId })` after `companiesOf` under `withUser`. Existing RequireAny implementation is reused from merged #468. Astra's independent design advice completed on gpt-6-astra high, task `node:delegated-task:command%3Amcp%3A411d9858-97f9-4382-ba7c-0e99b04a1c00%3Adelegate-task%3A0692b3ed-662f-4c10-bea8-f9f69860db19`; it is design advice, not executed-test or implementation-review evidence.

The planner disclosed searching five governing docs instead of full reads. The parent must finish full governing-document verification before application edits; this plan does not misrepresent the planner's receipt as satisfying that gate. The manager review file records the independent personal review and required corrections.
