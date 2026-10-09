# ADR-0038 — Migration data steps (employee name keys re-key)

- **Status:** Accepted — owner (Waleed) accepted on 2026-10-09
- **Date:** 2026-10-09
- **Scope:** `packages/db` migration runner; issue #139 (follow-up of PR #136, spec 038)

## Context

PR #136 (row 8b) added `employees.name_en_key` / `name_ar_key`. Migration 0097 filled existing rows
once with a SQL mirror of `employeeNameMatchKey`. The mirror is not exact: PostgreSQL `lower()` differs
from JavaScript `toLowerCase()` on `İ` (U+0130) and on final sigma, and on a C-locale server it lowers no
non-ASCII letter at all. Containers older than 8b, alive during a deploy or a rollback, could also leave
rows with NULL keys. The duplicate-name check compares stored keys only, so a wrong or NULL key hides a
real duplicate.

The one rule must be the TypeScript function in `packages/domain`. Running it needs Node, which SQL
migrations cannot do. It must also run **before** the NOT NULL contract is added, in the same release,
on every database (staging, production, the test template) without an operator remembering a manual step.
A worker job cannot guarantee that order: the worker starts only after the migrate step has finished.

## Decision

1. **Data steps in the migration runner.** A migration file may carry the comment line
   `-- pospay:data-step <name>`, exactly in that form at column 0 (`<name>` is `[a-z0-9-]+`). While that
   migration is pending, `applyMigrations` runs the registered TypeScript step `<name>` immediately before
   the migration's first statement, under the existing session advisory lock and after the same-session
   check. Before the first statement of the run, the runner resolves the markers of **every** pending
   migration: an unknown name, or any line that mentions `pospay:data-step` in another form (indented,
   inside a block comment, other case or spacing, trailing text), aborts the whole run before any step, any
   statement and any journal row. A journaled migration never runs its step again. A step must be
   idempotent: a crash before the journal row runs it again on the next start. The marker is a comment,
   so renumbering a migration at merge time does not detach it from its step.
2. **The step `employee-name-keys` reaches tenant data only through `withTenant`.** The migration owner
   (the recorded ADR-0003 §3 exception) reads only `SELECT id FROM companies ORDER BY id`. Before that read
   the step checks `rolsuper OR rolbypassrls` for `current_user` and fails closed when it is false — the
   intent of migration 0074's guard: without the bypass, FORCE RLS would return no companies and the step
   would "succeed" having fixed nothing. The refusal is a fixed message with no URL, password or row data. For each id the
   step opens `createDatabase` on `pospay_app` (URL built from `MIGRATION_DATABASE_URL` and the
   `POSTGRES_APP_PASSWORD` the migrate container already receives; no new variable, no new grant) and runs
   `withTenant(companyId, …)` transactions in keyset batches of 500 rows by `id`, `FOR UPDATE`. It computes
   both keys with `employeeNameMatchKey` for every row, soft-deleted rows included, and updates only rows
   whose stored keys differ, through the existing `UPDATE (name_en_key, name_ar_key)` column grant. It logs
   counts only (companies, rows read, rows updated), never a name. The pool is closed when the step ends.
3. **Contract in two migrations, both marked.** Migration 0101 adds
   `employees_name_en_key_present CHECK (name_en_key IS NOT NULL) NOT VALID` (brief ACCESS EXCLUSIVE, no
   scan). Migration 0102 runs `VALIDATE CONSTRAINT` in its own transaction (SHARE UPDATE EXCLUSIVE, so the
   running containers keep reading and writing during the scan). Both carry the marker, so a crash between
   them re-keys again before VALIDATE.

## Order inside the release

`migrate` (one-shot, before `api` and `worker`, `service_completed_successfully`): roles → migrations up
to 0100 (already applied on staging) → step → 0101 → step (no-op) → 0102 → `api`/`worker` start. During
the migrate step the old containers keep serving; the current staging image (bbc67c6) and its rollback
target (a3c2c30) both write TypeScript keys on every employee insert and name update, so nothing they write
violates the CHECK. Once 0101 commits, no NULL `name_en_key` can be written by anyone.

## Consequences

- Release rule: from this release on, **no image older than a3c2c30 (PR #136) may run** against the
  database. Its employee create would fail the CHECK. All later images write keys.
- `@pospay/db` gains the workspace dependency `@pospay/domain` (zero-dependency shared kernel; no cycle,
  no new library). The migrate image carries it through `pnpm deploy`.
- Migration 0097 and its SQL mirror stay byte-for-byte unchanged (merged migrations are immutable). The
  mirror is historical only; the parity test records its accepted gap (`İ`, final sigma, C locale), and
  proves the re-key step corrects such rows.
- Every test fixture that inserts an employee must store `name_en_key` (and `name_ar_key` when `name_ar`
  is set), computed with `employeeNameMatchKey`.
- `name_ar_key` has no constraint here; its correctness rests on the writers and this step.
- A future data step follows the same shape: a marker on the migration that needs it, a registered
  idempotent TypeScript step, tenant data only through `withTenant`.
- **A step must stay runnable against the schema at its own migration.** On a fresh database (the CI test
  template, a new production database) every marked migration runs in order, so a step registered today
  runs against the schema as it was at its migration, not the latest one. When a later migration renames,
  drops or tightens a table, column, grant or helper the step uses, that same change must either guard the
  step (it checks what it needs and becomes a no-op when the data it fixes cannot exist), or freeze it (the
  step keeps its own copy of the SQL and rules it needs as of its migration). Deleting a registered step is
  never allowed while a migration still carries its marker: the runner would abort as "unknown".
