# ADR-0061 — Reminder-schedule recovery by the worker (CS-Q32): company-id read, guarded self-clear, bounded retry

- **Status:** Proposed — for Waleed's acceptance (technical decision, `CLAUDE.md` §1 5b). No 56b-1 code is written before it is accepted and 52-1 is merged.
- **Date:** 2026-11-22
- **Scope:** spec 059 row 56b-1, FR-053 _CS-Q32_, FR-054, FR-055, CM-57, CM-57b, CM-57c, CM-58, CM-R09.
  Owner decisions already taken: CS-Q31 (the existing `pospay_dispatcher` holds `SELECT` and `INSERT` on the flag
  table, Waleed and Abu Salem, 2026-10-23) and CS-Q32 (the worker rebuilds every company's schedule itself and clears
  its own flag only when every company succeeded, 2026-10-23, option 2, against the recommendation).
- **Open technical questions** (answered by Waleed only): recorded in
  `docs/specs/059-commissions-statements/owner-questions.ar.md` §62 (CS-Q53), marked `PENDING`; the rules that depend on
  them are marked `TODO(spec)` there. They are listed at the end of this ADR.
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
read or change, that a clear happens once, for one named incident of one code, together with its audit record, and
that their arguments have the right shape. They cannot see Redis. **Verifying Redis, and the soundness and
completeness of the rebuild, is the worker's responsibility** (points 4 and 6); the definer never treats its arguments
as proof of recovery, and the audit record states what the worker claimed.

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
| `public.clear_reminder_schedules_lost_flag(flag_id uuid, rebuilt_run_id text, rebuilt_pass_id uuid, companies_rebuilt integer, audit_id uuid)` | `pospay_recovery_flag_clearer` | `boolean`: true when this call cleared the flag | `UPDATE (cleared_at, cleared_by)` on `operational_recovery_flags`; `INSERT` on `platform_audit_log` |

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
| `pospay_dispatcher` (CS-Q31, narrowed) | `SELECT` and **`INSERT (id, code, raised_at)`** on `operational_recovery_flags` — a column-level `INSERT`, so the dispatcher can raise a flag but can never insert a ledger row that is already cleared; plus `EXECUTE` on the two functions |

`companies` has forced RLS with policies `TO pospay_app` only (migration 0002), so the reader role needs its own policy:
`CREATE POLICY companies_recovery_select ON companies FOR SELECT TO pospay_recovery_company_reader USING (deleted_at IS NULL)`
(a role-scoped policy, the same documented exception ADR-0003 §3 records for `pospay_dispatcher` on `outbox`; it reads
context through no helper because there is no tenant). The flag table and `platform_audit_log` have no RLS (global, no
tenant data). No runtime role gains `BYPASSRLS`; no runtime role gains a table privilege beyond CS-Q31's, and CS-Q31's
`INSERT` is narrowed to the raise-time columns.

**What `pospay_dispatcher` holds after this ADR, in full:** what it holds today (`outbox`, the idempotency sweep), plus
`SELECT` and `INSERT (id, code, raised_at)` on `operational_recovery_flags`, plus `EXECUTE` on the two functions above.
**It can:** list ids of live companies, page by page, and only the id; raise a flag; list flags; clear **one named
incident of the reminder code** once. **It cannot:** read any company column but `id`, any tenant table, or
`platform_audit_log`; insert a flag with `cleared_at` or `cleared_by` set; `UPDATE`, `DELETE` or `TRUNCATE` the flag
table directly; clear a flag of another code, by code, in bulk or twice; write an audit row of its own shape (the
function writes it).

**Argument validation.** The clear function rejects, before any update, a null argument, a `rebuilt_run_id` that is not
the 40-character lowercase hexadecimal shape of a Redis `run_id` (`^[0-9a-f]{40}$`) and a negative `companies_rebuilt`,
with `invalid_parameter_value` (22023). This is validation of metadata shape, not verification of recovery (see _Who is
responsible for what_): the audit trail can never receive free text through it.

### 2. (a) The narrow read of company ids, and what it does and does not guarantee

The worker pages `recovery_company_ids(after_id, page_size)` until a short page; the rebuild never sees a name, a
setting or a tenant row. Each company is then handled with its **own** tenant context: the rebuild upserts the BullMQ
scheduler from the id alone (job data `{ companyId }` only, outside any transaction, FR-053), and the reminder job it
schedules later reads the company's businesses under `withTenant` as `pospay_app`, as FR-053 already says.

**Consecutive keyset pages are not a snapshot.** Each page is its own statement under READ COMMITTED. This ADR does not
pretend otherwise and defines one coverage rule, stated identically in point 6:

- **A company the pass reads is rebuilt and counted** toward the pass's success like any other, whenever it was
  created: a company committed during the pass **may** be read by a later page.
- **A company the pass does not read** — created with an id below the current cursor (UUID v7 is time-ordered, but two
  API instances can disagree by a clock skew) or after the last page — is covered by the worker `commissions` consumer
  of `CompanyCreated` that 56b-1 registers (FR-053; the ADR-0037 precedent; the module map's `CompanyCreated` event row,
  today consumed by `staff`, gains `commissions` in the code PR). The event is published in the creating transaction
  and delivered after commit, so its upsert lands in the Redis that exists then.
- **Confirmation listing.** After the last page the pass lists again from the start; any id not rebuilt yet is rebuilt
  and counted, and the pass repeats until one full listing adds nothing (at most five listings, then the pass ends and
  the remaining ids are left to the consumer). This removes the dependence on the consumer for every company that
  existed before the last listing began.
- A third path repairs a single lost schedule without any pass: every `commissions.project-inputs` delivery upserts
  the company's scheduler (FR-053, CM-57b).
- A consumer delivery that fails is retried by the outbox dispatcher; a parked event raises the existing parked-event
  alert.
- **Mixed-version rollout.** An older worker that does not know the new consumer can acknowledge `CompanyCreated`
  without scheduling. Therefore (i) the first pass that certifies readiness starts only after workers of the previous
  version have stopped (the staging service runs one worker replica and the runbook's deploy receipt lists the replicas;
  production follows the same rule), and (ii) the sentinel records the **worker release** that wrote it (point 4): a
  worker whose release differs from the sentinel's runs a silent re-certification pass (below), so a rollback followed
  by a re-upgrade, or a rolling deploy, is always re-scanned and never inherits an old certificate.

### 3. (b) The clear: one transaction, one incident, one code, one fixed identity

`clear_reminder_schedules_lost_flag` is bound to the reminder code, not to the ledger in general (the ledger is
designed for other codes): after the argument validation of point 1 it runs `UPDATE operational_recovery_flags SET
cleared_at = now(), cleared_by = <system identity> WHERE id = flag_id AND code = 'COMMISSION_REMINDER_SCHEDULES_LOST'
AND cleared_at IS NULL` and, only if a row changed, inserts one `platform_audit_log` row: `actor = 'system:worker'`,
`action = 'recovery.flag_cleared'` (matches the table's `^[a-z]+\.[a-z_]+$` check), `target_user_id` null,
`details = { flag_id, code, rebuilt_run_id, rebuilt_pass_id, companies_rebuilt }`, with `audit_id` from the worker's
injected `IdGenerator`. If the update changes no row (unknown id, **an incident of another code**, already cleared) it
writes nothing and returns false. A failed audit insert rolls back the clear: a flag is never cleared without its record.

**The fixed system identity** (`cleared_by`): a constant uuid, `00000000-0000-7000-8000-000000000061`, defined once in
`packages/db` and never a user row; the flag table has no foreign key on `cleared_by` (ADR-0054 §2 does not give it
one), and the `CHECK ((cleared_at IS NULL) = (cleared_by IS NULL))` still holds. The operator's audited command keeps its
own identity, so the ledger shows whether a machine or a person cleared an incident.

### 4. (c) Passes, the recovery marker and the readiness sentinel

FR-053 starts from a Redis with **no sentinel**: a first deploy, or a Redis lost while the worker was down. A guard that
required the sentinel to clear would make a first recovery impossible. So the worker keeps three Redis keys with three
jobs, and every rebuild pass has an identity of its own:

| Key | Meaning | Written by | Value |
| --- | --- | --- | --- |
| **recovery lease** `commissions:reminders:recovery:lock` | "one worker is running a pass" | the worker starting a pass (`SET NX PX 120000`), renewed by its heartbeat | the worker's id |
| **recovery marker** `commissions:reminders:recovery` | "this is the pass that is recovering this generation" | the pass, first thing | `{ incident_id, run_id, pass_id }`: the incident, the Redis `run_id` read at the start (`R0`), and a **unique `pass_id`** (a UUID v7 from the worker's injected `IdGenerator`, new for every pass, even for the same incident and the same `run_id`) |
| **readiness sentinel** `commissions:reminders:sentinel` (FR-053) | "this generation was fully rebuilt and verified by this release" | the worker, only by the guarded write of step 6 | `{ release, run_id }`: the worker release (image identity) and the `run_id` it vouches for |

**Single flight, and fencing.** At most one worker runs a pass at a time (the lease; a replica that does not hold it
only waits, and takes it over after the lease expires). The lease can itself vanish with a flush, so it is **not** what
protects correctness: the **`pass_id` in the marker is the fencing token**. A new pass overwrites the marker with its
own `pass_id`; every guard below compares the marker's `pass_id` with the pass's own, so an older pass whose marker
disappeared and was written again by a newer pass (same `incident_id`, same `run_id`) sees a different `pass_id`, is
**superseded**, stops, and neither clears nor publishes.

The heartbeat judges readiness **healthy** only when the sentinel exists, its `run_id` equals the current Redis
`run_id`, **and** its `release` equals the worker's own. A missing sentinel, or a `run_id` that differs, is a **loss**
(FR-053: a changed `run_id` alone raises the flag; a false positive costs one idempotent rebuild). A sentinel whose
`release` differs while `run_id` matches is **not** a loss: the worker runs a **silent re-certification pass** — the same
steps with no incident, no flag, no alert and `/ready` unchanged, and with step 5 (the clear) skipped — and then writes
the sentinel with its own release.

**One pass, in order:**

1. Detection (start-up or the heartbeat) of a loss: `INSERT … ON CONFLICT DO NOTHING` raises the flag (the partial
   unique index keeps one open flag; its id is **the incident id**, the existing open one when there is one),
   `/ready` turns degraded, the alert is raised.
2. Take the lease; read `R0`; generate `pass_id`; write the **marker** `{ incident_id, R0, pass_id }`.
3. Rebuild every company (point 2). After every page the pass checks that the marker still holds **its own** `pass_id`
   and `R0`, and that the server's `run_id` is still `R0`. If the marker holds another `pass_id` the pass is
   **superseded** and stops (a newer pass owns the incident). If the marker vanished or the `run_id` changed, the pass is
   abandoned and a **new** pass starts from step 2 (a new `pass_id`); it never clears.
4. Immediately before the clear, check the same things again.
5. Call the clear with the incident id, `R0` and the pass id. **Readiness depends on its answer:**
   - **true** — this call cleared this incident: go to step 6.
   - **false** — the incident was not cleared by this call (it was already cleared, by another pass or by the operator
     command, or it is not this code's): publish nothing; read the flag and the open flags; if a **newer** incident is
     open, keep `/ready` degraded and let that pass own it. A false answer **never raises a new flag by itself**.
   - **unknown** (timeout, lost connection, lost response): keep `/ready` degraded; read the incident row by id; if it is
     still open, repeat from step 4 (the guards are re-verified); if it is cleared and the marker still holds this
     pass's `pass_id`, treat it as acknowledged and go to step 6; otherwise stop.
6. Publish readiness, **guarded in Redis in one script**: it writes `{ release, run_id: R0 }` to the sentinel only if
   the marker still holds this pass's `pass_id` and `incident_id` and the server's `run_id` is still `R0`; then it
   deletes the marker and the lease. If the guard refuses, nothing is published.

**Two workers racing.** If two workers both reach step 5 for the same incident (one after a takeover, one superseded
too late), exactly one `UPDATE` changes the row: that call gets true; the other gets false. The loser publishes no
readiness (step 6's guard also fails: the winner deleted or replaced the marker), raises **no** new flag for that reason
alone, and stops. The winner's audit row names its `rebuilt_pass_id`.

**Walk-through (expected outcome of each case):**

| Case | What happens | Outcome |
| --- | --- | --- |
| **First run on an empty Redis** (CM-57b, first deploy) | step 1 finds no sentinel and raises the flag (incident `I1`); marker `{I1, R0, P1}`; every company rebuilt; guards hold; clear `I1` returns true; guarded publish succeeds | flag cleared, sentinel = `{release, R0}`, `/ready` healthy; the audit row names `R0`, `P1` and the count |
| **The marker is lost in the middle of a rebuild while `run_id` stays the same** (a `FLUSHDB` without a restart, which also deletes the schedulers already upserted) | the check after a page sees the marker missing → the pass is abandoned; the flag is unchanged (still open, same incident) | a new pass `P2` from step 2 rebuilds **all** companies again (the earlier upserts are gone) and only then clears; `P1` never clears |
| **An older pass whose marker disappears and is written again by a newer pass** with the same `incident_id` and `run_id` | `P1` still runs; `P2` writes the marker `{I1, R0, P2}`; `P1`'s next check (or step 4, or step 6's script) sees `pass_id` `P2` ≠ `P1` | `P1` is superseded: it does not clear and does not publish; `P2` owns the incident and clears only after its own full rebuild |
| **A worker restart between the clear and the write of the sentinel** | the flag is cleared but the sentinel is missing; at start-up step 1 raises a **new** flag (incident `I2`) | one more full idempotent pass and a second audit row; safe and conservative, `/ready` degraded for the length of one pass |
| **A loss between step 4 and step 5**, or after the clear and before the publish | the clear may still happen (the database cannot know); step 6's guard finds the marker gone and refuses to publish | the sentinel stays missing, so the next heartbeat raises a new incident and a new pass runs: the loss is **never absorbed** and readiness never looks healthy (see the residual window below) |
| **A worker restart in the middle of a pass** | start-up finds no sentinel; the open flag is the incident; a new marker with a new `pass_id` overwrites the old | a new pass from step 2; the old pass is simply discarded |
| **A deploy of a new worker release** (`run_id` unchanged, sentinel present) | the sentinel's `release` differs | a silent re-certification pass; no flag, no alert, `/ready` unchanged |
| **The operator fallback** (the worker cannot use the clear) | after the `CompanyCreated` replay the operator command clears the incident by id (owner role, audited) **and** writes the sentinel `{ release: 'operator', run_id: <current> }` using the same guarded script | the next heartbeat finds the sentinel with a matching `run_id`; the release differs, so one silent re-certification pass follows; no incident is reopened |

**The residual window, stated outright.** Redis and PostgreSQL are two stores and cannot be committed together. Between
the last Redis check (step 4) and the commit of the clear there is a window of milliseconds in which Redis can be lost
**after** the database has recorded the clear. CS-Q32 says a loss during recovery must restart the rebuild and not close
the incident; this design keeps the **safety** property (readiness is never published for a lost generation, the
alarm is raised again within one heartbeat) but the **record** of the incident can be closed one pass too early, with
its audit row stating what was verified (`R0`, the pass, the count) and a new incident opened right after. Accepting
this ADR accepts that split-store exception and its audit semantics; if Waleed does not accept it, the alternative is to
keep the incident open until the **next** heartbeat has re-verified the published generation, at the cost of one more
Redis round trip and a longer degraded period.

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

The flag clears only in a pass in which **every** company id the pass **read** succeeded — including a company created
during the pass that a later page or the confirmation listing read (point 2: a company the pass reads is counted like
any other) — and the guards of point 4 held. One failed company keeps the flag open, `/ready` degraded and the alert
repeating (Waleed's design note, owner-questions §32). Companies the pass did **not** read are covered by the consumer
(point 2) and are outside the count. **CM-57c:** a business that is quiet (no input, no plan write, no generate, no
statement row) is part of the pass like any other: its company's scheduler is rebuilt from the id, and on its next run
the reminder job creates the `DRAFT` row through `lockStatementPeriods` (FR-053: the helper creates the row of a quiet
business), writes the ledger entry `commission_statement_reminders` and sends the reminder; the worker stays degraded
until **every** read company is rebuilt, so a quiet business is never the reason a loss is declared healed too early. A
company whose `commissions` feature is off still gets its scheduler (the reminder job itself ends the transaction
without writing, FR-053).

### 7. Fallback kept

The owner-role operator command (audited clear by incident id, `platform_audit_log` in the same transaction) and the
controlled operator replay of `CompanyCreated` stay as the **documented fallback**, for a worker that cannot reach the
database function or a company that cannot be rebuilt. They are not the primary path any more. The command finishes by
publishing the sentinel as described in the walk-through, so a successful operator recovery leaves readiness healthy
and does not reopen the incident.

## What the code PR must amend

`CLAUDE.md` §5 (the dispatcher sentence: it also reads company ids through one definer and clears one named flag
through another, and inserts flags by column; the "no fifth way" paragraph names both as recorded exceptions beside the
outbox dispatcher and the migration data step); ADR-0003 §3 (the `pospay_dispatcher` row, the two function-owner roles in
the roles table, a section "global operational flags"); ADR-0054 §2 (the _Access_ and _Clearing_ paragraphs, already
marked superseded by CS-Q32, now point here; the `INSERT` narrowed to `(id, code, raised_at)`); `docs/runbook.md` (the
Redis-restore procedure: automatic recovery first, the operator command and the replay as fallback; the three Redis keys;
the rollout rule of point 2; the alert and `/ready` behaviour); `packages/db/src/roles.ts` (the two roles) and
`packages/db/src/dispatcher.ts` (the facade gains `raiseRecoveryFlag`, `openRecoveryFlags`, `companyIdPage`,
`clearRecoveryFlag`); the **privilege inventory**: `packages/db/test/function-inventory.ts` (both functions,
`prosecdef: true`, `proconfig` with `search_path` and `row_security`), `packages/db/test/table-grants.ts`
(`operational_recovery_flags` `SELECT` and the column `INSERT` for `pospay_dispatcher`, the column `UPDATE` and the table
`INSERT` for the clearer role, `companies.id` for the reader role) and `packages/db/src/__tests__/privileges.spec.ts`
(role attributes, memberships, ownership of exactly one function each, no schema `CREATE`, effective privileges); the
module map (`docs/module-map.md`: the worker `commissions` rows for the recovery reader, and the `CompanyCreated` event
row gaining the `commissions` consumer, point 2).

## Tests the code PR must carry

CM-57, CM-57b, CM-57c, CM-58, CM-R09 (spec 059) and, specific to this ADR (CM-58b stays the recipient-authorization
case of the reminders; the cases below are CS-Q32 cases):

- Each function refuses `PUBLIC`, `pospay_app`, `pospay_auth`, `pospay_notifications` (no `EXECUTE`); the reader returns
  ids only, only of live companies, in order, and the dispatcher still cannot `SELECT` from `companies`;
  **the dispatcher cannot insert a flag with `cleared_at` or `cleared_by` set** (permission denied).
- The clear changes nothing for an unknown id and an already-cleared id and returns false; **the id of an open incident
  of another code is not cleared and writes no audit row**; a null, a malformed `rebuilt_run_id` and a negative count are
  rejected with 22023 before any update; it never touches another flag; its audit row exists exactly when the flag was
  cleared, and a forced audit failure leaves the flag open; `pospay_dispatcher` cannot `UPDATE` or `DELETE` the flag
  table; the facade exposes no raw client.
- The life cycle of point 4 on a real Redis: the first run on an empty Redis ends healthy; a marker deleted mid-pass
  restarts the pass and never clears the aborted one; **an old pass whose marker disappears and is written again by a
  newer pass with the same `incident_id` and `run_id` must NOT clear and must NOT publish**; two workers racing on one
  incident: exactly one clear returns true, the other returns false, publishes nothing and raises no new flag; a clear
  that returns false or has an unknown outcome publishes no readiness; a loss between the guard and the clear leaves
  the sentinel missing and raises a new incident; a restart between the clear and the sentinel write raises a new
  incident and ends healthy after one more pass; a release change runs a silent re-certification (no flag, no alert);
  the operator completion path leaves the next heartbeat healthy without reopening the incident; one failing company
  keeps the flag open.
- **A company created between two pages ends with a scheduler**: one the pass reads (counted) and one it does not read —
  an id below the current cursor, one created after the last page (covered by the `CompanyCreated` consumer) — and a
  quiet company is part of the pass (CM-57c).

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
  cross-tenant transaction or a new table; the coverage rule of point 2 gives the same result with the consumers that
  already exist.
- **One Redis key as both marker and sentinel, and a marker without a pass identity.** The first cannot express "being
  recovered" and "recovered" at once (the first recovery would be impossible); the second lets an older pass accept a
  marker written by a newer one (point 4).
- **Operator-only recovery (the original FR-053).** Superseded by CS-Q32.
- **Reading company ids from `outbox` `CompanyCreated` events.** Only the dispatcher can read `outbox`, it holds events
  until they are deleted, and an old company's event may be gone; it also needs the operator replay.

## Consequences

- The dispatcher role gains two `EXECUTE` privileges and the CS-Q31 table grants (the `INSERT` narrowed by column):
  three new surfaces, all id-only or incident-and-code-bound. `CLAUDE.md` §5 and ADR-0003 grow two named exceptions.
- A migration adds the two roles, their grants and policy, and the two functions; the flag table itself is 56b-1's.
- A worker that cannot reach Redis cannot clear; a worker that cannot reach the database cannot rebuild; both leave
  the incident open and `/ready` degraded.
- A restart at the wrong moment costs one extra pass and one extra audit row, never a missed recovery; every deploy
  costs one silent re-certification pass (one idempotent upsert per company).
- The split-store residual window of point 4 is an explicit, accepted exception.

## Open questions for Waleed (technical, answered by him only)

Recorded in `owner-questions.ar.md` §62 (CS-Q53) as `PENDING`. Each is asked separately; each states what it changes.

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

Accepting the ADR also accepts the split-store residual window of point 4 (not a sixth question: it is part of the
design this ADR proposes).
