# ADR-0061 — Reminder-schedule recovery by the worker (CS-Q32): company-id read, guarded self-clear, bounded retry

- **Status:** Proposed — for Waleed's acceptance (technical decision, `CLAUDE.md` §1 5b). No 56b-1 code is written before it is accepted.
- **Date:** 2026-11-22
- **Scope:** spec 059 row 56b-1, FR-053 _CS-Q32_, FR-054, FR-055, CM-57, CM-57b, CM-57c, CM-58, CM-58b, CM-R09.
  Owner decisions already taken: CS-Q31 (the existing `pospay_dispatcher` holds `SELECT` and `INSERT` on the flag
  table, Waleed and Abu Salem, 2026-10-23) and CS-Q32 (the worker rebuilds every company's schedule itself and clears
  its own flag only when every company succeeded, 2026-10-23, option 2, against the recommendation).
- **Amends, in the 56b-1 code PR (not here):** `CLAUDE.md` §5, ADR-0003 §3, ADR-0054 §2, `docs/runbook.md`, the
  privilege inventory and the module map (see _What the code PR must amend_).

## Context

The per-company reminder schedule (the BullMQ job scheduler `commissions-statement-reminders-<companyId>`) lives only
in Redis. If Redis is lost, the reminders stop silently. FR-053 requires the loss to be detected and recorded **outside
Redis** (the append-only ledger `operational_recovery_flags`, ADR-0054 §2, code `COMMISSION_REMINDER_SCHEDULES_LOST`),
and CS-Q32 requires the worker to **recover by itself**: rebuild every company's schedule and clear the flag, with no
operator in the loop. That needs three things no runtime role has today:

1. A read that spans **all companies**. `CLAUDE.md` §5 allows exactly one such reader, the outbox dispatcher on
   `outbox`; ADR-0038 allows the migration owner to read `companies.id` during the one-shot `migrate` step only.
2. A **clear**. CS-Q31 gave `pospay_dispatcher` only `SELECT` and `INSERT` on the flag table (ADR-0054 §2: the runtime
   must not be able to clear an alarm it did not earn the right to clear).
3. An **audit path** for that clear. `platform_audit_log` is written today only by `pospay_auth` and the owner-role
   scripts (`platform:grant`); it is insert-only and has no tenant.

Each point touches the sentence "there is no fifth way to reach tenant data" (`CLAUDE.md` §5, ADR-0003 §2–§3), so it is
a security decision and needs Waleed's acceptance before any code. This ADR defines the five points FR-053 _CS-Q32_
lists, (a) to (e), plus the CM-57c case (a business with no statement row).

## Decision

### 1. Two definer functions, two function-owner roles, one caller

Follow the pattern of ADR-0012 §2 (`pospay_approval_reader`) and ADR-0013 (`pospay_suppression_reader`): a function-owner
role per function, `NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION`, member of no role,
owning exactly one function and nothing else; no runtime role may inherit or `SET ROLE` to it. The caller of both
functions is `pospay_dispatcher` (CS-Q31) through the existing facade `createOutboxDispatcherDatabase`; no new login
role, pool, URL or secret.

| Function | Owner role | Returns | Reads / writes |
| --- | --- | --- | --- |
| `public.recovery_company_ids(after_id uuid, page_size integer)` | `pospay_recovery_company_reader` | one page of company ids, ascending, `page_size` clamped to 1…1000 | `SELECT (id)` on `companies`, only rows with `deleted_at IS NULL` |
| `public.clear_operational_recovery_flag(flag_id uuid, rebuilt_run_id text, companies_rebuilt integer, audit_id uuid)` | `pospay_recovery_flag_clearer` | `boolean`: true when this call cleared the flag | `UPDATE (cleared_at, cleared_by)` on `operational_recovery_flags`; `INSERT` on `platform_audit_log` |

Both: `SECURITY DEFINER`, `STABLE` only where read-only, not `LEAKPROOF`, `SET search_path = pg_catalog, pg_temp`,
`SET row_security = on`, every relation and helper schema-qualified, fixed SQL with no dynamic execution, no
`PUBLIC` privilege: `REVOKE ALL ON FUNCTION … FROM PUBLIC, pospay_app, pospay_auth, pospay_notifications,
pospay_suppression_reader, pospay_approval_reader`, then one `GRANT EXECUTE … TO pospay_dispatcher`. Create, transfer
ownership, revoke and grant in the same migration transaction; the migration owner leaves no schema `CREATE` privilege
on either role. Effective (inherited and `PUBLIC`) privileges are asserted, not only ACL rows.

**Grants the two roles need (and nothing more):**

| Grantee | Exact privilege |
| --- | --- |
| `pospay_recovery_company_reader` | `USAGE ON SCHEMA public`; `SELECT (id) ON public.companies` |
| `pospay_recovery_flag_clearer` | `USAGE ON SCHEMA public`; `SELECT, UPDATE (cleared_at, cleared_by) ON public.operational_recovery_flags`; `INSERT ON public.platform_audit_log` |

`companies` has forced RLS with policies `TO pospay_app` only (migration 0002), so the reader role needs its own policy:
`CREATE POLICY companies_recovery_select ON companies FOR SELECT TO pospay_recovery_company_reader USING (deleted_at IS NULL)`
(a role-scoped policy, the same documented exception ADR-0003 §3 records for `pospay_dispatcher` on `outbox`; it reads
context through no helper because there is no tenant). The flag table and `platform_audit_log` have no RLS (global, no
tenant data). No runtime role gains `BYPASSRLS`; no runtime role gains a table privilege beyond CS-Q31's.

**What `pospay_dispatcher` holds after this ADR, in full:** what it holds today (`outbox`, the idempotency sweep), plus
`SELECT, INSERT` on `operational_recovery_flags` (CS-Q31), plus `EXECUTE` on the two functions above.
**It can:** list ids of live companies, page by page, and only the id; raise a flag; list open flags; clear **one named
incident** once. **It cannot:** read any company column but `id`, any tenant table, or `platform_audit_log`; `UPDATE`,
`DELETE` or `TRUNCATE` the flag table directly; clear a flag by code, in bulk or twice; write an audit row of its own
shape (the function writes it).

### 2. (a) The narrow read of company ids

The worker pages `recovery_company_ids(after_id, page_size)` until a short page; the rebuild never sees a name, a
setting or a tenant row. Each company is then handled with its **own** tenant context: the rebuild upserts the BullMQ
scheduler from the id alone (job data `{ companyId }` only, outside any transaction, FR-053), and the reminder job it
schedules later reads the company's businesses under `withTenant` as `pospay_app`, as FR-053 already says. The id list
is a snapshot per pass: a company created after the pass started is registered by the existing `CompanyCreated`
consumer, so it is not lost, and the pass does not wait for it.

### 3. (b) The clear: one transaction, one incident, one fixed identity

`clear_operational_recovery_flag` runs in a single statement-level transaction (the function body): it
`UPDATE operational_recovery_flags SET cleared_at = now(), cleared_by = <system identity> WHERE id = flag_id AND
cleared_at IS NULL` and, only if a row changed, inserts one `platform_audit_log` row, `actor = 'system:worker'`,
`action = 'recovery.flag_cleared'` (matches the table's `^[a-z]+\.[a-z_]+$` check), `target_user_id` null,
`details = { flag_id, code, rebuilt_run_id, companies_rebuilt }` with `audit_id` from the worker's injected
`IdGenerator`. If the update changes no row (unknown id, already cleared) it writes nothing and returns false. A failed
audit insert rolls back the clear: a flag is never cleared without its record.

**The fixed system identity** (`cleared_by`): a constant uuid, `00000000-0000-7000-8000-000000000061`, defined once in
`packages/db` and never a user row; the flag table has no foreign key on `cleared_by` (ADR-0054 §2 does not give it
one), and the `CHECK ((cleared_at IS NULL) = (cleared_by IS NULL))` still holds. The operator's audited command keeps its
own identity, so the ledger shows whether a machine or a person cleared an incident.

### 4. (c) The generation guard: Redis `run_id` and the sentinel

The database cannot see Redis, so the guard lives in the worker and is bound into the audit record:

1. At the **start** of a rebuild the worker reads Redis's `run_id` and the fixed sentinel key and keeps both (`R0`).
2. It rebuilds every company (point 2). A loss detected by the heartbeat **during** the rebuild (a changed `run_id` or a
   vanished sentinel) abandons the pass and starts a new one from the top; it never clears.
3. Immediately **before** calling the clear it reads both again (`R1`). If `R1 ≠ R0`, or the sentinel is missing, it
   does not clear.
4. It calls the clear naming the incident id it rebuilt for and `R0`'s `run_id`; the audit record shows which
   generation was rebuilt.
5. It **keeps** the `run_id` it rebuilt for. A change its heartbeat sees after the clear raises a **new** flag (the
   partial unique index allows it once the old one is cleared). A loss that lands between steps 3 and 4 is therefore
   never absorbed: the next heartbeat compares against the generation that was rebuilt, not against the latest one.

Only after the flag is cleared does the worker write the sentinel for the generation it rebuilt (FR-053).

### 5. (d) The bounded retry, `/ready` and the alert

While a flag is open: `/ready` reports **degraded**; the alert with the fixed code `COMMISSION_REMINDER_SCHEDULES_LOST`
is raised on every start and **repeats on every retry round**. A company whose rebuild failed is retried with backoff
**1 min, 2 min, 4 min, 8 min, then 15 min per round, until the pass completes** (bounded in time between attempts, not
in number: the incident stays open and visible until it is repaired, so a cap on attempts would only hide it). Companies
that succeeded are not redone in the same pass. A flag that survives a worker restart is picked up again at start.

### 6. (e) Clear only when every company succeeded

The flag clears only in a pass in which **every** company id of the snapshot succeeded and the guard of point 4 held.
One failed company keeps the flag open, `/ready` degraded and the alert repeating (Waleed's design note, owner-questions
§32). **CM-57c:** a business that is quiet (no input, no plan write, no generate, no statement row) is part of the
pass like any other: its company's scheduler is rebuilt from the id, and on its next run the reminder job creates the
`DRAFT` row through `lockStatementPeriods` (FR-053: the helper creates the row of a quiet business), writes the ledger
entry `commission_statement_reminders` and sends the reminder; the worker stays degraded until **every** company is
rebuilt, so a quiet business is never the reason a loss is declared healed too early. A company whose `commissions`
feature is off still gets its scheduler (the reminder job itself ends the transaction without writing, FR-053).

### 7. Fallback kept

The owner-role operator command (audited clear by incident id, `platform_audit_log` in the same transaction) and the
controlled operator replay of `CompanyCreated` stay as the **documented fallback**, for a worker that cannot reach the
database function or a company that cannot be rebuilt. They are not the primary path any more.

## What the code PR must amend

`CLAUDE.md` §5 (the dispatcher sentence: it also reads company ids through one definer and clears one named flag
through another; the "no fifth way" paragraph names both as recorded exceptions beside the outbox dispatcher and the
migration data step); ADR-0003 §3 (the `pospay_dispatcher` row, the two function-owner roles in the roles table, a
section "global operational flags"); ADR-0054 §2 (the _Access_ and _Clearing_ paragraphs, already marked superseded by
CS-Q32, now point here); `docs/runbook.md` (the Redis-restore procedure: automatic recovery first, the operator command
and the replay as fallback; the alert and `/ready` behaviour); `packages/db/src/roles.ts` (the two roles) and
`packages/db/src/dispatcher.ts` (the facade gains `raiseRecoveryFlag`, `openRecoveryFlags`, `companyIdPage`,
`clearRecoveryFlag`); the **privilege inventory**: `packages/db/test/function-inventory.ts` (both functions,
`prosecdef: true`, `proconfig` with `search_path` and `row_security`), `packages/db/test/table-grants.ts`
(`operational_recovery_flags` `INSERT` and `SELECT` for `pospay_dispatcher`, the column `UPDATE` and the table `INSERT`
for the clearer role, `companies.id` for the reader role) and `packages/db/src/__tests__/privileges.spec.ts` (role
attributes, memberships, ownership of exactly one function each, no schema `CREATE`, effective privileges); the module
map (`docs/module-map.md`: the worker `commissions` rows for the recovery reader and the event row).

## Tests the code PR must carry

CM-57, CM-57b, CM-57c, CM-58, CM-58b, CM-R09 (spec 059) and, specific to this ADR: each function refuses `PUBLIC`,
`pospay_app`, `pospay_auth`, `pospay_notifications` (no `EXECUTE`); the reader returns ids only, only of live
companies, in order, and the dispatcher still cannot `SELECT` from `companies`; the clear changes nothing for an
unknown or already-cleared id and returns false; it never touches another flag; its audit row exists exactly when the
flag was cleared, and a forced audit failure leaves the flag open; `pospay_dispatcher` cannot `UPDATE` or `DELETE` the
flag table; the facade exposes no raw client; a lost Redis in CI rebuilds every company and clears only after all
succeeded (CM-58b), a mid-rebuild loss restarts the pass, and a loss after the clear raises a new flag.

## Alternatives considered

- **A column `UPDATE (cleared_at, cleared_by)` grant to `pospay_dispatcher`.** Simplest, but the runtime could then clear
  any flag by any id from any code path; D-24 and ADR-0054 §2 refuse that. The definer fixes the incident id, the
  one-time effect and the audit row.
- **A new login role `pospay_recovery` with its own facade.** Cleaner separation, but a connection pool, an env URL, a
  deploy secret and a facade entry; CS-Q31 chose the existing role.
- **`BYPASSRLS` on the dispatcher or the worker.** Refused: no runtime role has it (ADR-0003 §3).
- **Owner-owned definers (the `sweep_expired_idempotency_keys` pattern).** The owner is the bootstrap superuser with
  `BYPASSRLS`; function-owner roles with exact grants make the effective privileges small and auditable.
- **Operator-only recovery (the original FR-053).** Superseded by CS-Q32.
- **Reading company ids from `outbox` `CompanyCreated` events.** Only the dispatcher can read `outbox`, it holds events
  until they are deleted, and an old company's event may be gone; it also needs the operator replay.

## Consequences

- The dispatcher role gains two `EXECUTE` privileges and the CS-Q31 table grants: three new surfaces, all id-only or
  incident-bound. `CLAUDE.md` §5 and ADR-0003 grow two named exceptions.
- A migration adds the two roles, their grants and policy, and the two functions; the flag table itself is 56b-1's.
- A worker that cannot reach Redis cannot clear; a worker that cannot reach the database cannot rebuild; both leave
  the incident open and `/ready` degraded.
- The retry is unbounded in number on purpose and bounded in rate; the alert repeating is the cost of not hiding a
  half-healed state.

## Open questions for Waleed (technical, answered by him only)

1. Two function-owner roles (as above) or one role owning both functions? Two is least-privilege; one is fewer objects.
2. The backoff (1, 2, 4, 8, then 15 minutes) and the page size (1000).
3. The fixed system identity uuid `00000000-0000-7000-8000-000000000061`, with no foreign key on `cleared_by`.
4. The audit `actor` text `system:worker` and `action` `recovery.flag_cleared`.
