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

## Addendum 2026-11-01 — `customer_notes` keys on `(company_id, customer_id, business_id)` (spec 073, CI-T7)

This addendum **records an existing explicit owner decision; it does not take a new one.** It narrows the Decision
above to one table. The Decision, its Context and its Consequences are unchanged for every other tenant table.

**Evidence, all dated 2026-11-01.** CI-T7 is a technical question, so it went to Waleed only and his answer is
final (CLAUDE.md §1 5b). He answered it as `PP-103.7` on a card in «شات مدير الويب» that reached the manager at
≈13:31 Kuwait time, choosing the recommended option: a new `customer_notes` table whose key is
`(company_id, customer_id, business_id)`, carrying the note, with RLS on `company_id`, a negative isolation test,
and indexes on the foreign keys. The manager's own reconciliation message, «من المدير (13:40 الكويت)» in the 34b
session chat, confirms that shape and gives the reason `business_id` stays in the key, verbatim:

> «خلي business_id في المفتاح عشان لو أبو سالم اختار «لأ» في CI-Q17، المنع يرجع بسياسة من غير ما نغيّر شكل الجدول.»

The later feature decision CI-Q17 (`PP-102.17`) lifts the read-blocking half of `PP-103.7` — reading across
businesses **inside the same company** is allowed — and the same reconciliation states that the key is unchanged
by that. The decision is carried in `docs/specs/073-customers-import/spec.md` (D-8), recorded verbatim in
`docs/specs/073-customers-import/owner-questions.ar.md` (CI-T7, and the CI-Q17 reconciliation), and indexed under
PP-103 in `docs/owner-decisions.ar.md`.

**What the exception is, and what it is not.**

- It applies to `customer_notes` only. Every other tenant table keeps `(company_id, id)`.
- `customer_notes` has no `id` column, so there is no single-column surrogate key here to protect and nothing a
  cross-tenant uniqueness check could reveal. Its composite key starts with `company_id`.
- **All tenant uniqueness still starts with `company_id`.** No unique constraint spans tenants, and this addendum
  creates no global `id` uniqueness oracle and removes none: no table gains one.
- The foreign keys to `customers` and `businesses` stay tenant-qualified on `(company_id, id)`, exactly as the
  Decision requires everywhere else.
- The RLS policy on `customer_notes` is company-scoped (`company_id = app_company_id()`), and the negative
  isolation test — A sees no note of B and cannot insert a note under B — is in
  `packages/db/src/__tests__/rls-customer-notes.spec.ts`.

**Why the reason behind the Decision still holds.** The Decision exists so that a uniqueness check on `id` alone
cannot reveal another tenant's rows. `customer_notes` has no `id`, and its uniqueness is decided only inside one
`company_id`, so the oracle the Decision forbids cannot arise. Keeping `business_id` in the key — rather than
narrowing it to `(company_id, customer_id)` — is what lets a future policy confine reads to one business without a
table-shape change, which is the reason the manager gave.

**Status.** Accepted as a table-specific exception to the key shape only. No general invariant is relaxed.
