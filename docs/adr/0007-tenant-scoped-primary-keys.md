# ADR-0007 — Tenant tables key on `(company_id, id)`

- **Status:** Accepted
- **Date:** 2026-09-23
- **Slice:** Phase 0 · T5 — tenancy schema (Codex review of PR #21, P1)

## Context

T5 first gave `businesses` and `branches` a global primary key on `id`, plus a `(company_id, id)` unique
constraint for the tenant-qualified foreign keys. A uniqueness check is not filtered by row-level security:
company A can insert a row with a guessed `id` under its own `company_id`, and a duplicate-key error — or
`ON CONFLICT DO NOTHING RETURNING` coming back empty — tells A that the `id` exists in some other tenant. The
PostgreSQL documentation warns about exactly this. With UUID v7 ids, guessing is impractical, but ids leak (URLs,
logs, shared receipts), and the existence oracle is avoidable at no cost while there is no data.

## Decision

Every **tenant** table's primary key is **`(company_id, id)`**, and there is **no unique constraint on `id`
alone**. Child tables reference their parent through `(company_id, parent_id)` — the tenant-qualified foreign key
already required by `CLAUDE.md` §5 — which the composite primary key serves directly.

- `companies` is the exception: it is the tenant root, its `id` **is** the tenant key, and its `INSERT` policy only
  accepts `id = app_company_id()`, so a foreign id is refused before any uniqueness check runs.
- Global tables (`plans`, `permissions`, global-identity tables) keep single-column keys: they are not tenant data.
- `ON CONFLICT` targets on tenant tables name `(company_id, id)`.
- Two tenants may hold rows with the same `id`. Nothing may treat `id` alone as identifying a tenant row: every
  lookup is scoped by the tenant, which RLS already enforces.

## Consequences

- T5's tests assert that inserting B's `id` under A succeeds and leaves B's row untouched (no oracle).
- Every later tenant table follows this pattern; reviewers reject a tenant table with a single-column key.
- Event payloads and API paths keep carrying `id`; the tenant comes from the verified context, never from the id.
