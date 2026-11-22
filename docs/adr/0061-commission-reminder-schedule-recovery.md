# ADR-0061 — Reminder-schedule recovery by the worker (CS-Q32): company-id read, guarded self-clear, bounded retry

- **Status:** Proposed — for Waleed's acceptance (technical decision, `CLAUDE.md` §1 5b). No 56b-1 code is written before it is accepted and 52-1 is merged.
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

**Who is responsible for what.** The database functions below enforce **scope and atomicity only**: which rows they may
read or change, that a clear happens once, for one named incident of one code, together with its audit record. They
cannot see Redis. **Verifying Redis, and the soundness and completeness of the rebuild, is the worker's
responsibility** (points 4 and 6); the definer never trusts its arguments as proof of recovery, and the audit record
states what the worker claimed.

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
| `public.clear_reminder_schedules_lost_flag(flag_id uuid, rebuilt_run_id text, companies_rebuilt integer, audit_id uuid)` | `pospay_recovery_flag_clearer` | `boolean`: true when this call cleared the flag | `UPDATE (cleared_at, cleared_by)` on `operational_recovery_flags`; `INSERT` on `platform_audit_log` |

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
incident of the reminder code** once. **It cannot:** read any company column but `id`, any tenant table, or
`platform_audit_log`; `UPDATE`, `DELETE` or `TRUNCATE` the flag table directly; clear a flag of another code, by code,
in bulk or twice; write an audit row of its own shape (the function writes it).

### 2. (a) The narrow read of company ids, and what it does and does not guarantee

The worker pages `recovery_company_ids(after_id, page_size)` until a short page; the rebuild never sees a name, a
setting or a tenant row. Each company is then handled with its **own** tenant context: the rebuild upserts the BullMQ
scheduler from the id alone (job data `{ companyId }` only, outside any transaction, FR-053), and the reminder job it
schedules later reads the company's businesses under `withTenant` as `pospay_app`, as FR-053 already says.

**Consecutive keyset pages are not a snapshot.** Each page is its own statement under READ COMMITTED; a company
committed after the pass started may or may not appear in a later page. This ADR does not pretend otherwise and defines
the coverage guarantee precisely instead:

- A company **committed before the pass started** is visible to every page query whose cursor is below its id, and the
  cursor only moves upward from `NULL`, so it is listed exactly once.
- A company **created during the pass** is covered by the worker `commissions` consumer of `CompanyCreated` that 56b-1
  registers (FR-053; the ADR-0037 precedent; the module map's `CompanyCreated` event row, today consumed by `staff`,
  gains `commissions` in the code PR). The event is published in the creating transaction and delivered after commit,
  so its upsert lands in the Redis that exists then, which during a recovery is the new generation. This holds
  whatever id the company has: a company created with an id **below the current cursor** (UUID v7 is time-ordered but
  two API instances can disagree by a clock skew) is missed by the pass and covered by the consumer; one created
  **after the last page** is covered by the consumer, never by the pass. The pass therefore does not wait for it and
  does not count it.
- A third path repairs a single lost schedule without any pass: every `commissions.project-inputs` delivery upserts
  the company's scheduler (FR-053, CM-57b).
- A consumer delivery that fails is retried by the outbox dispatcher; a parked event raises the existing parked-event
  alert. The flag is not held open for a company outside the pass: its clear depends only on the companies the pass
  listed (point 6).

### 3. (b) The clear: one transaction, one incident, one code, one fixed identity

`clear_reminder_schedules_lost_flag` is bound to the reminder code, not to the ledger in general (the ledger is
designed for other codes): it runs `UPDATE operational_recovery_flags SET cleared_at = now(), cleared_by = <system
identity> WHERE id = flag_id AND code = 'COMMISSION_REMINDER_SCHEDULES_LOST' AND cleared_at IS NULL` and, only if a row
changed, inserts one `platform_audit_log` row: `actor = 'system:worker'`, `action = 'recovery.flag_cleared'` (matches
the table's `^[a-z]+\.[a-z_]+$` check), `target_user_id` null, `details = { flag_id, code, rebuilt_run_id,
companies_rebuilt }`, with `audit_id` from the worker's injected `IdGenerator`. If the update changes no row (unknown
id, **an incident of another code**, already cleared) it writes nothing and returns false. A failed audit insert rolls
back the clear: a flag is never cleared without its record. The function does not and cannot check Redis, the run id or
the company count; those arguments are recorded, not trusted (see _Who is responsible for what_).

**The fixed system identity** (`cleared_by`): a constant uuid, `00000000-0000-7000-8000-000000000061`, defined once in
`packages/db` and never a user row; the flag table has no foreign key on `cleared_by` (ADR-0054 §2 does not give it
one), and the `CHECK ((cleared_at IS NULL) = (cleared_by IS NULL))` still holds. The operator's audited command keeps its
own identity, so the ledger shows whether a machine or a person cleared an incident.

### 4. (c) The generation guard: a recovery marker, separate from the readiness sentinel

FR-053 starts from a Redis with **no sentinel**: a first deploy, or a Redis lost while the worker was down. A guard that
required the sentinel to clear would make a first recovery impossible. So two Redis keys with two jobs:

| Key | Meaning | Written by | Value |
| --- | --- | --- | --- |
| **recovery marker** `commissions:reminders:recovery` | "this is the generation being recovered, by this incident" | the worker, first thing in every rebuild pass | `{ incident_id, run_id }` — the Redis `run_id` read at the start of the pass (`R0`) |
| **readiness sentinel** `commissions:reminders:sentinel` (FR-053) | "this generation was fully rebuilt and verified" | the worker, only after the clear, by the guarded write below | the `run_id` it vouches for |

The worker's heartbeat treats the readiness as **healthy** only when the sentinel exists **and** its value equals the
current Redis `run_id`; a missing sentinel, or a value that differs from the current `run_id`, is a loss (FR-053: a
changed `run_id` alone raises the flag; a false positive costs one idempotent rebuild).

**One pass, in order:**

1. Detection (start-up, or the heartbeat): the sentinel is missing or stale → `INSERT … ON CONFLICT DO NOTHING` raises
   the flag (the partial unique index keeps one open flag; its id is **the incident id**, the existing open one when
   there is one), `/ready` turns degraded, the alert is raised.
2. Read `R0` (the current `run_id`) and write the **recovery marker** `{ incident_id, R0 }`.
3. Rebuild every company of the listing (point 2). During the pass the heartbeat checks that the `run_id` is still `R0`
   **and** the marker is still there with the same incident id; if either changed, the pass is **abandoned and restarted
   from step 2** (a new `R0`, a new marker) and never clears.
4. Immediately before the clear, check the same two things again.
5. Call the clear with the incident id and `R0`.
6. Write the readiness sentinel with `R0`, **guarded in Redis in one script**: it sets the sentinel only if the recovery
   marker still exists with the same incident id and `R0` is still the server's `run_id`, then deletes the marker. If
   the guard refuses, the sentinel stays missing.

**Walk-through (expected outcome of each case):**

| Case | What happens | Outcome |
| --- | --- | --- |
| **First run on an empty Redis** (CM-57b, first deploy) | step 1 finds no sentinel and raises the flag (incident `I1`); marker `{I1, R0}`; every company rebuilt; guard at step 4 holds; clear `I1`; guarded sentinel write succeeds | flag cleared, sentinel = `R0`, `/ready` healthy; the audit row names `R0` and the count |
| **The marker is lost in the middle of a rebuild while `run_id` stays the same** (a `FLUSHDB` without a restart, which also deletes the schedulers already upserted) | the heartbeat or step 4 sees the marker missing → the pass is abandoned; the flag is unchanged (still open, same incident) | a new pass from step 2 rebuilds **all** companies again (the earlier upserts are gone), writes a new marker and then clears; the aborted pass never clears |
| **A worker restart between the clear and the write of the sentinel** | the flag is cleared but the sentinel is missing; at start-up step 1 sees no sentinel and raises a **new** flag (incident `I2`) | one more full idempotent pass and a second audit row; safe and conservative, `/ready` degraded for the length of one pass |
| A loss between step 4 and step 5 (before the clear) | the clear still happens (the database cannot know), but step 6's guard finds the marker gone and refuses to write the sentinel | the sentinel stays missing, so the next heartbeat or start raises a new flag: the loss is **never absorbed** |
| A worker restart in the middle of a pass | start-up finds no sentinel; the open flag is the incident; a new marker overwrites the old | a new pass from step 2; the old pass is simply discarded |

The worker **keeps** the `run_id` it rebuilt for; a change its heartbeat sees afterwards raises a new flag (the partial
unique index allows it once the old one is cleared).

### 5. (d) The retry, `/ready` and the alert — two readings, not settled here

While a flag is open: `/ready` reports **degraded**; the alert with the fixed code `COMMISSION_REMINDER_SCHEDULES_LOST`
is raised on every start and **repeats on every retry round**. A company whose rebuild failed is retried while the flag
stays open; companies that succeeded are not redone in the same pass. A flag that survives a worker restart is picked up
again at start. The owner record of CS-Q32 (Arabic, «عدد محدود من المحاولات») and FR-053 («bounded backoff») can be
read two ways; this ADR does not choose between them for Waleed:

| | **Reading A — a cap on the wait between attempts, none on their number** (the author's proposal) | **Reading B — a cap on the number of attempts** |
| --- | --- | --- |
| Rule | backoff 1, 2, 4, 8 then 15 minutes per round, repeating at 15 minutes until the pass completes | the same backoff, stopped after `N` failed rounds of the same pass (e.g. 10, about 1 hour 45 minutes) |
| When exhausted | never exhausted: the incident stays open, `/ready` degraded and the alert repeating until the cause is repaired | the worker stops retrying, the flag stays open and `/ready` degraded, a distinct alert («recovery exhausted») is raised once, and nothing more happens until an operator restarts the worker (a new count) or runs the fallback command and the `CompanyCreated` replay |
| Risk | a permanently broken company causes endless rounds (cheap at 15 minutes) | reminders stay off for every company after exhaustion until someone acts |

**Recommendation: Reading A**, because the loss is silent and reminders matter for money (late approval): stopping
automatic recovery after a number of tries trades a visible-but-retrying incident for a visible-and-stalled one. The
choice is Waleed's (question ii below).

### 6. (e) Clear only when every company succeeded

The flag clears only in a pass in which **every** company id the pass **listed** succeeded and the guards of point 4
held. One failed company keeps the flag open, `/ready` degraded and the alert repeating (Waleed's design note,
owner-questions §32). Companies created during the pass are outside this set by definition (point 2). **CM-57c:** a
business that is quiet (no input, no plan write, no generate, no statement row) is part of the pass like any other: its
company's scheduler is rebuilt from the id, and on its next run the reminder job creates the `DRAFT` row through
`lockStatementPeriods` (FR-053: the helper creates the row of a quiet business), writes the ledger entry
`commission_statement_reminders` and sends the reminder; the worker stays degraded until **every** listed company is
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
and the replay as fallback; the two Redis keys; the alert and `/ready` behaviour); `packages/db/src/roles.ts` (the two
roles) and `packages/db/src/dispatcher.ts` (the facade gains `raiseRecoveryFlag`, `openRecoveryFlags`, `companyIdPage`,
`clearRecoveryFlag`); the **privilege inventory**: `packages/db/test/function-inventory.ts` (both functions,
`prosecdef: true`, `proconfig` with `search_path` and `row_security`), `packages/db/test/table-grants.ts`
(`operational_recovery_flags` `INSERT` and `SELECT` for `pospay_dispatcher`, the column `UPDATE` and the table `INSERT`
for the clearer role, `companies.id` for the reader role) and `packages/db/src/__tests__/privileges.spec.ts` (role
attributes, memberships, ownership of exactly one function each, no schema `CREATE`, effective privileges); the module
map (`docs/module-map.md`: the worker `commissions` rows for the recovery reader, and the `CompanyCreated` event row
gaining the `commissions` consumer, point 2).

## Tests the code PR must carry

CM-57, CM-57b, CM-57c, CM-58, CM-58b, CM-R09 (spec 059) and, specific to this ADR:

- Each function refuses `PUBLIC`, `pospay_app`, `pospay_auth`, `pospay_notifications` (no `EXECUTE`); the reader returns
  ids only, only of live companies, in order, and the dispatcher still cannot `SELECT` from `companies`.
- The clear changes nothing for an unknown id and an already-cleared id and returns false; **the id of an open incident
  of another code is not cleared and writes no audit row**; it never touches another flag; its audit row exists exactly
  when the flag was cleared, and a forced audit failure leaves the flag open; `pospay_dispatcher` cannot `UPDATE` or
  `DELETE` the flag table; the facade exposes no raw client.
- The life cycle of point 4 on a real Redis: the first run on an empty Redis ends healthy; a marker deleted mid-pass
  restarts the pass and never clears the aborted one; a loss between the guard and the clear leaves the sentinel
  missing and raises a new flag; a restart between the clear and the sentinel write raises a new flag and ends healthy
  after one more pass; one failing company keeps the flag open (CM-58b).
- **A company created between two pages ends with a scheduler** (through the `CompanyCreated` consumer), including one
  whose id is below the current cursor and one created after the last page; a quiet company is part of the pass
  (CM-57c).

## Alternatives considered

- **A column `UPDATE (cleared_at, cleared_by)` grant to `pospay_dispatcher`.** Simplest, but the runtime could then clear
  any flag by any id from any code path; D-24 and ADR-0054 §2 refuse that. The definer fixes the incident id, the code,
  the one-time effect and the audit row.
- **A new login role `pospay_recovery` with its own facade.** Cleaner separation, but a connection pool, an env URL, a
  deploy secret and a facade entry; CS-Q31 chose the existing role.
- **`BYPASSRLS` on the dispatcher or the worker.** Refused: no runtime role has it (ADR-0003 §3).
- **Owner-owned definers (the `sweep_expired_idempotency_keys` pattern).** The owner is the bootstrap superuser with
  `BYPASSRLS`; function-owner roles with exact grants make the effective privileges small and auditable.
- **A real snapshot of the company list** (a `REPEATABLE READ` transaction or a materialised copy). It would need a long
  cross-tenant transaction or a new table; the precise coverage guarantee of point 2 gives the same result with the
  consumers that already exist.
- **One Redis key as both marker and sentinel.** It cannot express "being recovered" and "recovered" at once, which is
  what makes the first recovery impossible (point 4).
- **Operator-only recovery (the original FR-053).** Superseded by CS-Q32.
- **Reading company ids from `outbox` `CompanyCreated` events.** Only the dispatcher can read `outbox`, it holds events
  until they are deleted, and an old company's event may be gone; it also needs the operator replay.

## Consequences

- The dispatcher role gains two `EXECUTE` privileges and the CS-Q31 table grants: three new surfaces, all id-only or
  incident-and-code-bound. `CLAUDE.md` §5 and ADR-0003 grow two named exceptions.
- A migration adds the two roles, their grants and policy, and the two functions; the flag table itself is 56b-1's.
- A worker that cannot reach Redis cannot clear; a worker that cannot reach the database cannot rebuild; both leave
  the incident open and `/ready` degraded.
- A restart at the wrong moment costs one extra pass and one extra audit row, never a missed recovery.

## Open questions for Waleed (technical, answered by him only)

Each is asked separately; each states what it changes.

1. **(i) Function-owner roles: one or two?** Two (`pospay_recovery_company_reader`, `pospay_recovery_flag_clearer`) give
   each function exactly the privileges it needs and nothing else; one role owning both is fewer objects but then the
   reader of company ids could also clear and write audit. Recommendation: two.
2. **(ii) Retry: a maximum wait between attempts, or a maximum number of attempts?** Reading A or Reading B of point 5,
   including what each does when exhausted. Recommendation: A (wait capped at 15 minutes, attempts not capped).
3. **(iii) Page size.** 1000 ids per page of `recovery_company_ids` (clamped by the function to 1…1000). It changes only
   the number of round trips of a pass.
4. **(iv) The fixed system identity.** The constant uuid `00000000-0000-7000-8000-000000000061` as `cleared_by`, with no
   foreign key on that column.
5. **(v) The audit texts.** `actor = 'system:worker'` and `action = 'recovery.flag_cleared'` in `platform_audit_log`.
