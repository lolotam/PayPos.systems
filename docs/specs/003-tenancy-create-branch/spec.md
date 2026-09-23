# 003 — tenancy · create-branch

> Plan v4 T8 · PRD P0-T8.2 · status: in progress

## What it does

Adds a branch to one business of the caller's verified company.

## API contract

- `POST /v1/businesses/:businessId/branches` · `@Require('create:branches:business', { business: 'businessId' })` ·
  `Idempotency-Key` (COMPANY scope). The business is part of the path so the permission is evaluated at that business
  (a business-scoped role may add branches to its own business only).
- **Request** — `createBranchInput` (the business comes from the path, not the body): `name_en`, `name_ar?`,
  `address_ar?`, `address_en?`, `geo?`, `opening_hours?`. Strict.
- **201** — `branch`. Replay: stored 201 with `idempotent-replayed: true`.

## Business rules

1. The business must belong to the verified company. The access guard checks this **before** evaluating the
   permission: a business id from another company, an unknown id and a malformed id are the same 403 (no oracle).
   The tenant-qualified FK `(company_id, business_id)` is the second line.
2. One transaction: claim the key, insert the branch (`is_active = true`), `AuditLog` `branch · created`, outbox
   `BranchCreated` `{ branch_id, business_id, company_id }`.

## Read side

`GET /v1/branches/:branchId` · `@Require('read:branches:branch', { branch: 'branchId' })` — one branch. Query
`branch-detail.query.ts` with a result-shape test and an `EXPLAIN` assertion on the primary key.

## Scenarios

| ID | Scenario |
|---|---|
| TEN-01 | happy path → branch, audit row, `BranchCreated` |
| TEN-02 | duplicate `Idempotency-Key` → identical stored response, one branch |
| TEN-03 | a business id of another company in the path → 403, nothing written |

## API-level isolation proof (plan T8, debate C11)

With a real session of company A, requesting company B is refused **before** `withTenant(B)` is called (spy on the
wrapper), **no tenant-business query executes** for the refused request (instrumented at the database boundary),
and company B's sentinel rows never appear in a response nor change.
