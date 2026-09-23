# 001 — identity · onboard-company

> Plan v4 T9a-4 · ADR-0003 §3, §5.3 · PRD P0-T9a.5 · status: implemented

## What it does

Creates a company together with its first owner. A company without an owner must never be observable, so the
company row, the owner membership, the `AuditLog` row and the `CompanyCreated` event are written in **one**
transaction or not at all.

## Who may call it

`POST /v1/companies` is guarded by `@RequirePlatform('create:companies:platform')`. The grant comes only from
`pnpm platform:grant`; no company role or override satisfies it. Whether merchants may self-onboard later is PRD
D-34 and does not change this route.

## API contract

- **Request** — `createCompanyInput` (`packages/contracts/src/tenancy/company.ts`): `name_en` (1–255), `name_ar?`
  (1–255), `plan_id`. Strict: unknown keys are refused. The owner is the session's user; the id is generated
  server-side inside `withNewTenant` and is never accepted from the client.
- **Headers** — `Idempotency-Key` (required, 1–255 visible ASCII).
- **201** — `company` (`id`, `name_ar`, `name_en`, `owner_user_id`, `plan_id`, `created_at`, `deleted_at: null`).
  A replay returns the stored 201 byte-for-byte with `idempotent-replayed: true`.
- **Errors** (envelope) — 401 `UNAUTHENTICATED`; 403 `FORBIDDEN` (no platform grant); 400
  `IDEMPOTENCY_KEY_REQUIRED`; 400 `VALIDATION_FAILED` (bad body, or `plan_id` unknown → `details[0].code =
  unknown_plan`); 409 `IDEMPOTENCY_KEY_IN_PROGRESS`; 422 `IDEMPOTENCY_KEY_REUSED`.

## Business rules

1. The transaction runs inside `withNewTenant(callerUserId, …)`: `app.user_id` = the caller, `app.company_id` = the
   new id.
2. **First** the `Idempotency-Key` is claimed in the caller's `USER` scope — before anything else is written.
3. The plan must exist; otherwise nothing is written and the key stays unclaimed (a corrected retry may reuse it).
4. `CompanyRegistry.register` (identity's port → tenancy's exported `registerCompany`) is the only company insert.
5. The owner membership: system `owner` role (`role_owner_key = 'global'`), `COMPANY` scope, open-ended.
6. `AuditLog` row `company · created` with the created company as `after`; outbox `CompanyCreated`
   `{ company_id, owner_user_id, plan_id }` (`identity/events/published.ts`).
7. **Last-owner protection** — a deferred constraint trigger refuses to commit any change to memberships that leaves
   a company with no open-ended user membership in the owner role (deleting, ending, or demoting the last one).

## Schema

No new table. Migration `0013_…_identity-last-owner` adds `assert_company_keeps_an_owner()` and the deferred
constraint trigger `memberships_keep_an_owner`.

## Scenarios (integration, real Postgres, real Better Auth sessions)

| ID | Scenario | Test |
|---|---|---|
| ONB-01 | happy path → company, owner membership, audit row, `CompanyCreated` | `apps/api/src/modules/identity/__tests__/onboard-company.spec.ts` |
| ONB-02 | the membership insert fails → no company, no outbox row, no idempotency key | same |
| ONB-03 | replayed key → identical stored response, one company; different body → 422 | same |
| ONB-04 | two users (created with `platform:create-user` + `platform:grant`) each create a company through the API | same |
| — | no platform grant → 403; unknown plan → 400 without claiming the key | same |
| — | last owner cannot be deleted, ended or demoted; a swap in one transaction commits | `packages/db/src/__tests__/last-owner.spec.ts` |

## Open questions

- `TODO(spec)` D-34 — self-serve onboarding (does not reopen this route).
- `TODO(spec)` D-06 — real plans; today only the provisional plan exists.
