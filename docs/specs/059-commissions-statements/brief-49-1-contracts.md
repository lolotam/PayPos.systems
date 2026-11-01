# 49-1 implementation — four approved override contract kinds

Final owner authorization: CS-Q39 = PP-104.1, batch 89, both owners' page choice 1, relayed by the manager on
2026-11-01 at 16:06 Kuwait. Waleed confirmed «لأ، الأربع اختيارات بس» (2026-11-01, channel «كارت في شات مدير الويب»,
relayed at 16:07). This supersedes the earlier choice 0. Keep only FOLLOW_PLAN, ZERO, PCT and FIXED; the audit
retains the earlier choice. This remains the same 49-1 delivery and one PR.

## Write scope

- New `packages/contracts/src/commissions/service-overrides.ts`.
- New `packages/contracts/src/commissions/service-overrides-openapi.ts`.
- New `packages/contracts/src/commissions/__tests__/service-overrides.spec.ts`.
- `packages/contracts/src/commissions/plan-versions.ts`: export the existing `commissionPlanDate` scalar without
  changing its validation or schema identifier.
- `packages/contracts/src/index.ts`: export the new contract module.
- `packages/contracts/src/openapi.ts`: register the new schemas and paths alongside plan versions.
- `packages/contracts/src/__tests__/openapi.spec.ts`: add the new named components to the existing exact schema
  inventory without weakening the committed-artifact assertion. Parent regenerates the artifact separately.

No other file edits. No migration, database schema, engine, API implementation, UI, dependency, lockfile, tooling,
generated OpenAPI/client, owner audit or plan changes. The parent regenerates artifacts after reading the delivery.

## Required behavior

Reuse `serviceCommissionRule` and `serviceCommissionRuleView` from `catalog/service.ts` in this same contracts
package. They already encode the settled four kinds: `FOLLOW_PLAN`, `ZERO`, `PCT` with integer `value` from 0 to
10000 bps, and `FIXED` with a nonnegative KWD string carrying exactly three decimal places within numeric(14,3).
Use those schemas directly for overrides; do not copy the validators or extend either union. Reject FOLLOW_SERVICE
as an unknown kind. No reset-to-service behavior is approved; FOLLOW_PLAN means the employee plan, and only the
absence of an eligible override falls back to the saved line snapshot. Keep catalog/service.ts unchanged.
Never use a JS number for a monetary amount. Do not add an optional extension hook.

Export the input/output types inferred from these schemas, following existing contracts naming and metadata:

- `createCommissionServiceOverrideInput`: strict body `{ service_id, rule, effective_from }`. Use existing `id` and
  `commissionPlanDate`. Reject extra keys, including `whole_period`.
- `commissionServiceOverride`: stored response `{ id, employee_id, service_id, rule, effective_from, created_at,
  created_by }`. Reuse `id`, `commissionPlanDate`, `timestamp` and `responseObject`. Preserve `responseObject`'s
  unknown-field behavior; do not force response `.strict()`.
- `commissionServiceOverrideListQuery`: strict `{ service_id?, cursor?, limit }`. Cursor is an opaque base64url
  string, 1–512 characters; limit coerces a query string, defaults to 20 and is bounded 1–100.
- `commissionServiceOverrideListItem`: the stored response plus `is_current: boolean`. The effective date remains
  available for future rows. No predictive statuses or pricing logic in contracts.
- `commissionServiceOverrideList`: `items` bounded to 100 and a nullable `next_cursor` with the same cursor bounds.
  Reuse the package's page helper where it fits without weakening these bounds.
- `commissionServiceOverrideSchemas`: the new named schemas for the OpenAPI registry. Reused named schemas are
  already registered; avoid duplicate components with the same metadata id.
- Export rule types only where actual consumers need them. Reuse the existing serviceCommissionRule component;
  no separate override-rule component is needed. Keep the exact OpenAPI inventory aligned with the registered schemas.

OpenAPI paths are the existing FR-011 / FR-013 route:
`/v1/businesses/{businessId}/employees/{employeeId}/commission-overrides`.

POST has `x-company-id`, both path ids and `Idempotency-Key`; 201 stored response, 400 malformed request, 403 uniform
permission/feature refusal, 404 employee/service absent, 409 closed month or busy idempotency key, and 422 date in
the past or `IDEMPOTENCY_KEY_REUSED`. Reuse existing error components for the two 422 codes. GET has the same company
and path parameters plus the bounded list-query parameters; 200 list response, 400 invalid cursor/query, 403, 404,
and the normal error-envelope fallback. Document current/history semantics without inventing another read API.
Operation ids: `createCommissionServiceOverride` and `listCommissionServiceOverrides`.

## Proof to author, not execute

Add meaningful contract tests for every valid rule and its invalid boundary, fixed-money losslessness and exact
precision, year-zero rejection and valid leap date, strict input/no `whole_period`, cursor alphabet and bounds,
limit coercion/default/bounds, stored/list response shape including `is_current`, and OpenAPI registration/path
references. Prove FOLLOW_SERVICE is rejected by override and ordinary catalog contracts. Keep existing plan-version tests and behavior
unchanged. Do not weaken the OpenAPI schema inventory or skip generation checks.

## Working limits

MiniMax edits files only. No shell, commands, git, tests, build, scripts, network, MCP, delegation, publication or
server access. No `.env*`, `.git`, logs, secrets, or reads outside this worktree. Read the local governing documents
and relevant source with file-reading tools; run nothing. Do not reformat unrelated code or compress lines to evade
lint limits. Parent reads every changed source/test/config before executing any check. Report changed files and any
unresolved defect honestly; do not claim tests or generation passed.
