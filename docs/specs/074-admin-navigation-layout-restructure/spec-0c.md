# 074 step 0c — Workspace business type and country: API specification

**Status:** Draft design document; this task does not change code.

**Date:** 2026-11-21

**Base commit:** `09574e9e774eaac08c5a35955cbde2f8d9f7f85a`

**Dependency:** PR #1161 `(32b-1 + 34-pre-3)` is the base commit and supplies the stored business country. Its commit subject is `feat(catalog, tenancy): service import rules and business country (32b-1 + 34-pre-3) (#1161)`.

**Tier:** Medium. Owner approval, verbatim: «اعتمد Medium» (Waleed, 2026-11-21; source: handoff delegated task). `pr-sequence.md:14` recommends Medium for 0c because it is a read-only API contract change with no money, permission or migration impact.

**Companion:** [plan-0c.md](plan-0c.md).

## 1. Scope

This document specifies step 0c of `pr-sequence.md`: add two read-only fields to the `WorkspaceBusiness` object returned by the existing `GET /v1/me/workspaces` route, and carry them through the regenerated API client. The fields are needed by 074 step 7 to apply the page-entry `businessTypes` and `countries` conditions already described in `data-model.md:26-27` and required by `spec.md:FR-027`.

In scope:

- The public Zod contract `WorkspaceBusiness`.
- The existing tenancy workspace-tree read behind `GET /v1/me/workspaces`.
- Result-shape and plan assertions, generated OpenAPI/client artifacts and their checks.

Out of scope:

- Any new endpoint, mutation path, permission, role, RLS policy, migration, seed or data step.
- Any front-end consumption. 074 steps 1 to 7 own the navigation model and UI.
- Any change to shared 074 files (`spec.md`, `plan.md`, `data-model.md`, `pr-sequence.md`, `contracts/me-preferences.md`) in this documentation-only task.
- Changing existing authorization, filters, ordering, tenancy boundaries or error behavior.

## 2. Code-facing decisions and evidence

| ID | Decision | Evidence at the base commit |
|---|---|---|
| D-0c-1 | Add the response keys `business_type` and `country` to `WorkspaceBusiness`. Both are required keys; `country` is nullable. | `packages/contracts/src/identity/workspaces.ts:19-25` currently has `id`, `name_ar`, `name_en` and `branches` in snake_case. `data-model.md:26-27` and `spec.md:FR-027` name the consumer conditions `businessTypes` and `countries`; the wire keys follow the existing response naming. |
| D-0c-2 | `business_type` is read directly from `businesses.vertical_type`; its values are `restaurant`, `salon`, `laundry`, `retail`, `services`. | `packages/db/schema/tenancy.ts:69` defines `verticalType` as `NOT NULL`; `packages/db/schema/tenancy.ts:84-87` adds the `businesses_vertical_type` CHECK. `packages/contracts/src/tenancy/business.ts:11-13` defines the same `verticalType` enum. The value is not inferred from the template copied into `settings`. |
| D-0c-3 | `country` is read from the existing `businesses.settings` JSONB key `country`, using the shared `country` contract. Accepted codes are `KW`, `SA`, `AE`, `BH`, `QA`, `OM`. | `packages/db/schema/tenancy.ts:74-76` defines `settings` JSONB. `packages/contracts/src/reference/country.ts:5-7` defines the six accepted codes. `docs/specs/072-catalog-services-import/delivery-32b-1-34-pre-3-spec.md:144-147` (B-1) identifies `settings.country` as the source and explicitly excludes the `settings` module's `tax_rule.country_code`. |
| D-0c-4 | Missing, malformed, non-string or otherwise invalid stored `country` maps to `null`. No fallback from currency, timezone, tax rule or vertical template; no inference and no backfill. | `delivery-32b-1-34-pre-3-spec.md:151-153` (B-4) and `:172-177` (B-9). The shipped reader in `apps/api/src/modules/tenancy/queries/business-country.query.ts:26-31` validates with `country.safeParse` and returns `null` for an unset or invalid value. |
| D-0c-5 | Extend the existing bounded workspace-tree query; do not call a country reader once per business and do not add another I/O path. | `apps/api/src/modules/tenancy/queries/describe-workspaces.query.ts:50-54` documents one company read inside the caller's transaction, and `:54-84` builds one CTE query with tenant-bound `companyId` and grouped branches. `my-workspaces.query.ts:107-129` calls it once per authorized company. |
| D-0c-6 | Keep the existing route and read path unchanged. | `apps/api/src/modules/identity/http/me.controller.ts:28-34` already registers `@Get('me/workspaces')` with `@Authenticated()`, requires `principal.userId` and delegates to `myWorkspaces`. `apps/api/src/modules/identity/persistence/workspace-names.adapter.ts:3-10` is the single adapter to tenancy. |

`data-model.md:42` says the business carries neither value and that a country exists only in a tax rule. That was correct when 0a was written but is stale after PR #1161. It is not a source for this specification.

## 3. Public contract

The intended additive change to `packages/contracts/src/identity/workspaces.ts` is:

```ts
import { z } from 'zod';
import { responseObject } from '../response-object.js';

import { nameAr, nameEn } from '../bilingual/names.js';
import { country } from '../reference/country.js';
import { timeZone } from '../reference/time-zone.js';
import { verticalType } from '../tenancy/business.js';
import { id } from '../scalars/id.js';

// In OpenAPI 3.0.3 the nullable enum must allow null in its own value list.
const workspaceCountry = z
  .enum(country.options)
  .nullable()
  .meta({ enum: [...country.options, null] });

export const workspaceBranch = responseObject({
    id,
    name_ar: nameAr.nullable(),
    name_en: nameEn,
    effective_timezone: timeZone,
    is_active: z.boolean(),
  })
  .meta({ id: 'WorkspaceBranch' });

export const workspaceBusiness = responseObject({
    id,
    name_ar: nameAr.nullable(),
    name_en: nameEn,
    business_type: verticalType,
    country: workspaceCountry,
    branches: z.array(workspaceBranch),
  })
  .meta({ id: 'WorkspaceBusiness' });
```

`verticalType` and `country` are existing exports (`packages/contracts/src/index.ts:75` and `:48`); no new contract primitive is introduced. `WorkspaceBusiness`, `WorkspaceCompanyNames`, `WorkspaceCompany` and `MyWorkspacesResponse` keep their existing names and relationships.

Example of one returned business:

```json
{
  "id": "01920000-0000-7000-8000-0000000000a4",
  "name_ar": null,
  "name_en": "North Shop",
  "business_type": "retail",
  "country": "KW",
  "branches": []
}
```

A business with no valid stored country returns `"country": null`; the key is still present. `business_type` is never null because `businesses.vertical_type` is `NOT NULL` and has a matching CHECK.

## 4. Read behavior

- Every business object in the authorized response carries both fields. Scope filtering remains exactly as today: `COMPANY` reaches every business and branch, `BUSINESS` reaches that business and its branches, and `BRANCH` reaches that branch and its parent business (`describe-workspaces.query.ts:25-48` and its `branchHit`/`businessHit` CTEs).
- The company is still bound from `app_company_id()` inside the caller's transaction (`describe-workspaces.query.ts:86-91`, `:82-83`). Unknown scopes, a missing company and an empty scope list still return no tree, as specified by `describe-workspaces.query.ts:10-14`, `:115-118` and its existing tests.
- Company and membership aggregation, widest-role selection, company sorting by `name_en` then `id`, role lookup and the `{ companies: [...] }` envelope remain unchanged (`my-workspaces.query.ts:54-81`, `:97-105`, `:107-144`).
- No new row becomes visible. No existing row is hidden. Unauthorized companies and businesses never appear in the response.
- No new error code or envelope is added. Existing unauthenticated, forbidden, not-ready and bad-request behavior is unchanged.

## 5. Required evidence

1. **Result shape:** `apps/api/src/modules/tenancy/queries/__tests__/describe-workspaces.query.spec.ts:171-176` already parses `workspaceCompanyNames` and compares the full tree. Extend its expected businesses with `business_type` and `country`, covering a valid stored code, an unset key and an invalid or stale key. Keep the existing scope, ordering, duplicate-scope and cross-tenant assertions unchanged.
2. **HTTP result shape:** `apps/api/src/modules/identity/__tests__/me-workspaces.spec.ts:82-86`, `:111-160` and `:202-267` already parse `myWorkspacesResponse` and assert exact trees. Update the expected business objects so both new fields are proved on the real route for owner, business-scope and branch-scope calls. Keep the no-session, empty-membership, authorization, cross-company and ordering tests unchanged.
3. **Changed-query plan:** the `EXPLAIN (ANALYZE, FORMAT JSON)` proxy at `describe-workspaces.query.spec.ts:80-102` and plan test at `:225-240` must still pass against the changed query. Keep the tenant-index assertions for `companies`, `businesses` and `branches`, keep `expect(plan).not.toContain('Seq Scan')`, and confirm that no second per-business statement was introduced.
4. **Generated artifacts:** `pnpm contracts:openapi` regenerates `packages/contracts/openapi/openapi.json`; the three client generators must regenerate `apps/admin/src/shared/api/schema.d.ts`, `apps/menu/src/shared/api/schema.d.ts` and `apps/pos/src/shared/api/schema.d.ts`. In each artifact, `WorkspaceBusiness` contains both keys and `country` is nullable. Assert that the OpenAPI 3.0.3 country schema has `type: string`, `nullable: true` and an enum containing the shared country options and `null`. A nullable wrapper around the named, non-nullable `Country` schema would still reject `null`. The current pre-change artifacts show the missing fields at `openapi.json:44357-44389` and each `schema.d.ts:9011-9017`.
5. **Client acceptance checks:** `pnpm --filter @pospay/admin api:check`, `pnpm --filter @pospay/menu api:check` and `pnpm --filter @pospay/pos api:check` must pass after generation. Their scripts compare the committed `schema.d.ts` with a fresh generation from the OpenAPI document (`apps/admin/scripts/api-check.mjs:9-35`; the menu and POS scripts are equivalent). No client code consumes the fields in 0c.

## 6. Definition of done

- The contract, one tenancy query, the two API test files and the regenerated artifacts contain the additive fields and nothing else from this scope.
- All tests in §5 pass against a real test database, the plan assertions pass, and generated-client checks pass.
- Local gates for the implementer follow `CLAUDE.md:71`: typecheck, lint, `pnpm lint:docs`, boundaries, `pnpm module-map:check` and the slice's own tests. The work is not called merged until its exact-head `ci-gate` is green.
- The Medium implementer runs `clean-code-guard` and `test-guard`; the task session runs one `/code-review` under PP-198 (`CLAUDE.md:10`).

## 7. Decision status

No owner decision is open. The only owner approval required for this document set is the verbatim Medium approval recorded above. All implementation choices are tied to source evidence in §2; no question is sent to Waleed and no decisions-page entry is created.
