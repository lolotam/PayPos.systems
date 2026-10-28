# 58-2b plan — one-way opt-out database permissions and guard

Date: 2026-10-28. Status: **PLAN — awaiting Waleed's admission (technical question, below)**. Planner lane, docs only.
Parent: [`plan-58-2-split.md`](plan-58-2-split.md) §58-2b. Base: `main` `46a0e462`. No code, test or migration exists yet.

## Scope

Make the customer's rating opt-out writable by `pospay_app` inside `withTenant` (ADR-0011 §3, FR-B10) and make it
**one-way in the database** (RT-Q10, Abu Salem 2026-10-22, binding: whoever opted out stays opted out). One expand-only
migration adds a column-scoped `UPDATE` grant, an `UPDATE` RLS policy and a `SECURITY INVOKER` guard trigger on
`customers`; the privilege inventory and real-Postgres negative tests move with it. No route, parser, limiter, use case
or behaviour change: the grant stays inert until 58-2c writes through it.

## Verified facts (repository, 2026-10-28)

| Fact | Evidence |
|---|---|
| Highest migration on `main` is `0187` | `packages/db/migrations/meta/_journal.json` (idx 187) |
| `0188` is held by **57-3b**, not 58-2: an untracked `0188_2026-10-26_discount-self-approval-notices.sql` | worktree `feat/p1-057-3b-self-approval-notice` (Kimi correction, pipeline §7) |
| 58-2 never owned `0188`: the historical plan assigned **no** number | historical `plan-58-2.md` §10.2 («no migration number is assigned in this document») |
| No open PR; no other worktree holds `0188`+ | `gh pr list --state open` empty; per-worktree scan of `packages/db/migrations` |
| `customers` grants: `SELECT, INSERT` only; policies `customers_select`, `customers_insert` only; no trigger | `0035_2026-10-02_customers-rls.sql:6–12`; no later migration touches `customers` |
| Inventory lists `customers:INSERT`, `customers:SELECT` only; no column grant on `customers` | `packages/db/test/table-grants.ts:39–40`; `privileges.spec.ts` column list |
| The write target is `customers.opted_out_at` (`timestamptz`, nullable); no `updated_at` auto-bump exists | `0034_2026-10-02_customers.sql:7`; `schema/customers.ts:19` |
| No production code writes `opted_out_at`; only owner-role fixtures set it from `NULL` | `apps/api/.../customers.spec.ts:235` |

**Numbering:** 58-2b reserves **`0189`**, expected to merge after 57-3b (PP-69.9, constitution 3.2.0 Principle I).
The number is final at merge: if 57-3b has not merged or was dropped, the lead regenerates the scaffold on the
refreshed base and the SQL body moves unchanged.

## The migration — `0189_<date>_customers-opt-out-guard.sql` (custom, expand-only)

1. **Grant, column-scoped:** `GRANT UPDATE (opted_out_at, updated_at) ON customers TO pospay_app;` — the
   `rating_requests` precedent (`0185:158–159`). `updated_at` is included because the app stamps it from the injected
   `Clock`. No table-wide `UPDATE`, no `DELETE`, no other column, no other role.
2. **RLS policy:** `CREATE POLICY customers_update ON customers FOR UPDATE TO pospay_app USING (company_id =
   app_company_id()) WITH CHECK (company_id = app_company_id());` — mirrors `rating_requests_update` (`0185:132`).
3. **One-way guard:** `customers_opt_out_guard()` — `LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog,
   public`; `BEFORE UPDATE ON customers FOR EACH ROW`; when `OLD.opted_out_at IS NOT NULL AND NEW.opted_out_at IS
   DISTINCT FROM OLD.opted_out_at` it raises `ERRCODE '23514'`, `CONSTRAINT 'customers_opt_out_one_way'`; otherwise
   `RETURN NEW`. Then `REVOKE ALL ON FUNCTION … FROM PUBLIC` and `GRANT EXECUTE … TO pospay_app`, as every 0185 guard.
   One Arabic *why* comment above the function (§3.1): restoring is forbidden by RT-Q10, not by the app's goodwill.

Semantics: `NULL → instant` allowed (first opt-out); the same instant again allowed (ADR-0011 §3 keeps the first
time on retries); `instant → NULL` (restore) and `instant → other instant` refused. The guard reads `opted_out_at`
only; the column grant, not the guard, stops writes to identity and profile columns. The trigger binds every role,
the database owner included, so a future restore (58-3) needs its own migration — RT-Q10 by construction. A refusal
is a broken invariant (the app never attempts it), so it surfaces as a 500, not a typed error (`CLAUDE.md` §5).

**Also unlocks the row lock.** Postgres requires `UPDATE` on at least one column, and the `UPDATE` policy's `USING`,
for `SELECT … FOR UPDATE` / `FOR NO KEY UPDATE`. ADR-0011 §3 and D-B5 lock the customer row in both page opt-out
(58-2c) and the claim (59b), so this migration is a prerequisite for both. The lock **mode** stays 58-2c's decision
(`plan-58-2-split.md`: lock changes need fresh concurrency review).

**Not changed:** `schema/customers.ts` (no column), `test/table-grants.ts` (no `customers:UPDATE`), no index (the
write is a `customers_pkey` equality), no new role, no `BYPASSRLS`, no tenant-access exception, no ADR (the rule is
ADR-0011 §3 + RT-Q10; this migration implements it). Deploy: an inert expand step, safe before any code.

## Privilege inventory

- **New** `packages/db/test/customer-grants.ts`: `CUSTOMER_COLUMN_GRANTS = ['customers.opted_out_at:pospay_app:UPDATE',
  'customers.updated_at:pospay_app:UPDATE']` with a one-line Arabic why-comment, as `rating-grants.ts`.
- `packages/db/src/__tests__/privileges.spec.ts`: import it and spread `...CUSTOMER_COLUMN_GRANTS` into the column list.
- `packages/db/test/function-inventory.ts`: `{ proname: 'customers_opt_out_guard', prosecdef: false, proconfig:
  ['search_path=pg_catalog, public'] }`.

## Negative and positive tests — extend `packages/db/src/__tests__/rls-customers.spec.ts`

Extend the existing file (one DB clone per spec file, ADR-0006). Assert guard errors with `expectPgError(…, '23514',
'customers_opt_out_one_way')` (`test/rating-fixtures.ts`), as `rating-lifecycle.spec.ts` does. All as `pospay_app`.

| Case | Expected |
|---|---|
| `has_column_privilege` `UPDATE` on `opted_out_at`, `updated_at` / on `name`, `phone`, `locale`, `created_at`, `company_id`, `id` | `true` / `false` |
| Cross-tenant write: under `withTenant(A)`, `SET opted_out_at` on B's customer | **0 rows**; B's row unchanged (owner read-back) |
| Re-home: `SET company_id = B` | `42501` (column not granted) |
| Non-opt-out column: `SET name / phone / locale / created_at` | `42501` |
| `DELETE` | `42501` (unchanged) |
| First opt-out `NULL → t1` with `updated_at` | 1 row; every other column unchanged (read back) |
| Same value `t1 → t1` | succeeds, `opted_out_at` still `t1` |
| Restore `t1 → NULL` | `23514` `customers_opt_out_one_way`; row still `t1` |
| Replace `t1 → t2` | `23514`; row still `t1` |
| `updated_at` alone on an opted-out row | succeeds |
| `SELECT … FOR UPDATE` and `FOR NO KEY UPDATE` on A's row under `withTenant(A)` | succeeds; B's row returns 0 rows |
| No tenant context (`withUser`) | `UPDATE` affects 0 rows |

Retitle the existing «runtime cannot update, reassign or delete any customer» test to the column-scoped truth; its
assertions stay as they are.

## Exact write scope (implementer, MiniMax)

The lead first scaffolds in the task worktree: `pnpm --filter @pospay/db db:generate customers-opt-out-guard --custom`
(`packages/db/scripts/generate-migration.ts`), commits the empty
skeleton (SQL, `meta/0189_snapshot.json`, `_journal.json`). The implementer never forges a snapshot or journal entry.

1. `packages/db/migrations/0189_<date>_customers-opt-out-guard.sql` — fill the body below the scaffold header only
2. `packages/db/test/customer-grants.ts` — new
3. `packages/db/test/function-inventory.ts`
4. `packages/db/src/__tests__/privileges.spec.ts`
5. `packages/db/src/__tests__/rls-customers.spec.ts`

The generated `meta/0189_snapshot.json` and `meta/_journal.json` belong to the lead's scaffold. No shell, tests,
installs, Git writes or database operations by the implementer; it returns changed paths, reasoning and limits.

## Out of scope

58-2c (token parser, header transport, per-IP admission, opt-out use case, route, audit, contracts, clients, lock
mode); rating issuance, view/submit, page (59b, 60); any restore capability (58-3, not built by RT-Q10); WhatsApp STOP
(ADR-0013); a guard on `INSERT`; schema, index or role changes; staging or server operations.

## Local verification protocol (lead, expected, not run)

1. `node scripts/test-db/lane.mjs up 58-2b`; confirm `.env.test.local` points at this worktree's private cluster.
2. `pnpm --filter "@pospay/db^..." build`
3. `pnpm --filter @pospay/db typecheck` and `pnpm --filter @pospay/db lint`
4. `pnpm --filter @pospay/db exec vitest run src/__tests__/rls-customers.spec.ts src/__tests__/privileges.spec.ts
   src/__tests__/function-inventory.spec.ts src/__tests__/migration-client.spec.ts
   src/__tests__/concurrent-migrations.spec.ts` (the last two apply every migration)
5. `pnpm --filter @pospay/db exec vitest run src/__tests__/rating-lifecycle.spec.ts` and the API
   `customers.spec.ts` (owner sets `opted_out_at` from `NULL`; must stay green)
6. `pnpm lint:docs`, `pnpm module-map:check`, `git diff --check`, scope check against the five paths + scaffold
7. `node scripts/test-db/lane.mjs down 58-2b` after its ownership check. Record each result separately.

Full `pnpm check` runs on CI at the exact merge head (PP-69.7).

## Review route

Lead reads the diff → `clean-code-guard` / `test-guard` → **Astra** (`gpt-6-astra`, high) read-only database and
security review from fresh context (diff, this plan, ADR-0011, `CLAUDE.md` §5) → corrections on Kimi K3.1 Pro
(thinking `max`, database work) → five GitHub reviewers and CI on the exact head; backup before merge (§10).

## Risks

- **Every `pospay_app` path can now write `opted_out_at`/`updated_at` in its tenant**, not only 58-2c. Accepted: module
  boundaries keep other writers out; the guard fixes the direction, so a stray writer can opt out but never restore.
- **Numbering depends on 57-3b merging first.** The rebase rule handles either order; the lead regenerates the scaffold.
- **Owner-role fixtures** that ever reset `opted_out_at` to `NULL` will now fail; none exist today.
- **Lock privilege**: the claim (59b) cannot row-lock `customers` until this merges; sequence 58-2b before 59b.
