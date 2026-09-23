# 002 — tenancy · create-business

> Plan v4 T8 · PRD P0-T8.2 · status: in progress

## What it does

Adds a business (one vertical: restaurant, salon, laundry, retail, services) to the caller's verified company.

## API contract

- `POST /v1/businesses` · `@Require('create:businesses:company')` · `Idempotency-Key` (COMPANY scope) · company from
  `x-company-id` or the session hint, verified against the caller's memberships.
- **Request** — `createBusinessInput`: `vertical_type`, `name_en`, `name_ar?`, `currency` (default `KWD`), `timezone`
  (default `Asia/Kuwait`), `settings` (default `{}`). Strict.
- **201** — `business`. Replay: the stored 201 with `idempotent-replayed: true`.
- **Errors** — 401, 403 (no membership / no permission), 400 validation or key, 409 key in progress, 422 key reused.

## Business rules

1. `company_id` is the verified company, never taken from the request (CLAUDE.md §8).
2. **Settings** = the vertical's template (`packages/db/seed/vertical-templates.json`: `modules`, `features`), then the
   client's `settings` keys override matching keys (Waleed, 2026-09-23). A vertical is configuration, never an `if`.
3. One transaction: claim the key, insert the business, `AuditLog` `business · created`, outbox `BusinessCreated`
   `{ business_id, company_id, vertical_type }`.

## Read side

`GET /v1/businesses` · `@Require('read:businesses:company')` — the company's businesses, newest first, cursor
pagination (`limit` 1–100, default 50). Query `list-businesses.query.ts` with a result-shape test and an `EXPLAIN`
assertion on `businesses_company_id_created_at_idx`.

## Scenarios

| ID | Scenario |
|---|---|
| TEN-01 | happy path → business, audit row, `BusinessCreated`; settings = template + overrides |
| TEN-02 | duplicate `Idempotency-Key` → identical stored response, one business |
| TEN-04 | a user with memberships in A and B creates in the company they switch to |
| TEN-05 | a user requesting a company they do not belong to → 403 before `withTenant` is entered |
