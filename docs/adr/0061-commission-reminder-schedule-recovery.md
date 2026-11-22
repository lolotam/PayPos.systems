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
- **Mixed-version rollout and rollback.** An older worker that does not know the new consumer can acknowledge
  `CompanyCreated` without scheduling. Therefore (i) the first pass that certifies readiness starts only after workers
  of the previous version have stopped (the staging service runs one worker replica and the runbook's deploy receipt
  lists the replicas; production follows the same rule), and (ii) **every worker process start runs one
  re-certification pass** before the process reports ready (point 4), whatever the release: a rollback to an older
  worker followed by a return to the **same** release A is a new process start, so it is always re-scanned and never
  inherits the certificate it wrote earlier. The release is recorded for diagnosis only; it is not what triggers the
  pass.

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

### 4. (c) One ownership key, a pass identity, the readiness sentinel

FR-053 starts from a Redis with **no sentinel**: a first deploy, or a Redis lost while the worker was down. A guard that
required the sentinel to clear would make a first recovery impossible. So the worker keeps two Redis keys with two jobs,
and every rebuild pass has an identity of its own:

| Key | Meaning | Value |
| --- | --- | --- |
| **recovery key** `commissions:reminders:recovery` | "this pass owns the recovery of this generation": it is **both the lease and the marker**, one key with a TTL (120 s), never two | `{ incident_id, run_id, pass_id }`: the incident (null until raised, step 1), the Redis `run_id` read at the start (`R0`), and a **unique `pass_id`** (a UUID v7 from the worker's injected `IdGenerator`, new for every pass, even for the same incident and the same `run_id`) |
| **readiness sentinel** `commissions:reminders:sentinel` (FR-053) | "this generation was fully rebuilt and verified" | `{ release, run_id }`; the release is diagnostic only |

**Who may do what to the recovery key — every operation is a compare-and-set on the same `pass_id`, in one Redis
script; none is an unconditional write or delete:**

| Operation | Who | Condition |
| --- | --- | --- |
| **create** (acquire the lease and write the marker, atomically) | a worker or the operator command starting a pass | the key does not exist (`NX`); it is written with the pass's own `{ incident_id, R0, pass_id }` and the TTL |
| **update the incident id** | the same pass, once the incident is known | the stored `pass_id` equals the caller's |
| **renew** (heartbeat) | the same pass | the stored `pass_id` equals the caller's; otherwise the pass is superseded and must stop |
| **delete** (release) | the same pass, at publication or when it abandons | the stored `pass_id` equals the caller's |
| **expire** | Redis, by TTL | nobody else deletes or overwrites another pass's key |

Because acquisition and marker are one atomic write, there is no instant at which a worker holds the lease without the
marker, and a worker that pauses and returns finds its key missing or owned by another `pass_id`: its **every**
operation then fails closed. The lease only keeps replicas from duplicating work; **correctness rests on the `pass_id`
compare-and-set**, because a flush can erase the key at any time.

**Takeover.** Worker P1 owns the key and stops renewing (a pause, a stall): the TTL lapses. Worker P2 creates the key
with its own `pass_id`. From that instant P1 is **superseded**: P1 may still run code, but its renew, its pre-clear
check, its incident-id update, its delete and its publish all fail the `pass_id` compare, so it can neither disturb
P2's key nor publish readiness, and it stops. The one thing P1 can still do is call the clear function if it was already
past its last check (the race below): the database cannot tell a superseded pass from a current one.

**Detection.** The heartbeat judges readiness **healthy** only when the sentinel exists and its `run_id` equals the
current Redis `run_id`. A missing sentinel, or a different `run_id`, is a **loss** (FR-053: a changed `run_id` alone
raises the flag; a false positive costs one idempotent rebuild).

**One pass, in order:**

1. **Detect, and take ownership before raising anything.** On a loss the worker tries to **create** the recovery key
   (`incident_id` null). If the key exists (another pass owns it), it only waits and re-checks later; it raises nothing.
   If it created the key, it **re-reads the sentinel and the open flags under ownership**: if the sentinel is now
   healthy it deletes its key and stops; if a flag is open it adopts that incident id; otherwise it
   `INSERT … ON CONFLICT DO NOTHING` raises the flag (the partial unique index keeps one open flag), `/ready` turns
   degraded and the alert is raised. It then updates the key's `incident_id`. A flag is therefore only ever raised by the
   owner of the key, never by a replica that merely saw the sentinel missing between a clear and a publication.
2. Rebuild every company (point 2). After every page the pass **renews** the key (the compare-and-set above) and checks
   that the server's `run_id` is still `R0`. A failed renew means the key is gone or owned by another pass: if the key
   is gone the pass is abandoned and a **new** pass (new `pass_id`) starts after the backoff; if it is owned by another
   `pass_id` the pass is **superseded** and stops. It never clears.
3. Immediately before the clear, check the same things again. A failed re-verification abandons the pass the same way:
   it deletes its key (compare-and-set), `/ready` **stays degraded** (the incident is open), and the next pass follows
   the backoff of point 5; it counts as a failed round.
4. Call the clear with the incident id, `R0` and the pass id. **Readiness depends on its answer:**
   - **true** — this call cleared this incident: go to step 5.
   - **false** — this call did not clear it (already cleared by another pass or by the operator command, or not this
     code's): publish nothing, delete the key (compare-and-set) and stop; `/ready` stays degraded until the sentinel is
     healthy. A false answer **never raises a new flag by itself**.
   - **unknown** (timeout, lost connection, lost response) — **adopted rule: unknown is treated as not-mine.** The
     worker publishes nothing, deletes its key (compare-and-set), keeps `/ready` degraded and stops. It does **not**
     read the flag and credit itself: a closed flag plus its own key cannot prove that **this** pass committed the
     clear (after a takeover the superseded pass may have won while this one lost its response; the ledger's fixed
     identity cannot tell them apart and the dispatcher cannot read the audit row). The next heartbeat re-detects: the
     sentinel is missing, so the owner of the next key re-reads the flags under ownership — an open incident is adopted
     and rebuilt again, a closed one is replaced by a **new** incident (step 1) — and a new pass certifies the
     generation. The cost is one extra full idempotent pass and, if the first call had committed, one extra audit row.
5. **Publish readiness**, guarded in Redis in one script: it writes `{ release, run_id: R0 }` to the sentinel only if the
   recovery key still holds this pass's `pass_id` and incident and the server's `run_id` is still `R0`; in the same
   script it deletes the key (compare-and-set). If the guard refuses, nothing is published.

**The race between the clear and the publication, with both winner orderings.** The clear is one `UPDATE`: exactly one
call changes the row.

| Ordering | What happens | Outcome |
| --- | --- | --- |
| **W1: the pass that owns the key wins the clear** | its call returns true; step 5's guard holds; the sentinel is published | readiness restored, credited to this pass (its `pass_id` is in the audit row) |
| **W2: a superseded pass wins the clear** (it was past its last check when the new pass created the key) | the superseded call returns true but its step-5 compare fails (the key holds the other `pass_id`): it publishes nothing; the owner's call returns false: it publishes nothing and deletes its key | **neither pass publishes**, `/ready` stays degraded, the sentinel is missing. This is the explicit transition **back to loss detection**: the next heartbeat re-detects, an owner is elected, the flag is found closed, a **new incident** is raised and a new full pass certifies the generation. Readiness is restored by the new pass, never credited to the stale one |
| **A loss between step 3 and step 4, or after the clear and before the publish** | the clear may commit; the guard in step 5 finds the key gone or the `run_id` changed and refuses | sentinel missing, `/ready` degraded, the next heartbeat raises a new incident (see the residual window) |
| **A worker restart between the clear and the publish** | the sentinel is missing at start-up | detection takes ownership, finds the flag closed, raises a new incident, one more full pass; `/ready` degraded meanwhile |

**Walk-through (expected outcome of each case; an open incident or any mismatch keeps `/ready` degraded in every case):**

| Case | What happens | Outcome |
| --- | --- | --- |
| **First run on an empty Redis** (CM-57b, first deploy) | step 1 creates the key, finds no sentinel and no flag, raises incident `I1`; every company rebuilt; guards hold; the clear returns true; the guarded publish succeeds | flag cleared, sentinel written, `/ready` healthy; the audit row names `R0`, the pass and the count |
| **The key is lost in the middle of a rebuild while `run_id` stays the same** (a `FLUSHDB` without a restart, which also deletes the schedulers already upserted) | the next renew fails (key missing) → the pass is abandoned; the flag is unchanged (still open) | a new pass `P2` rebuilds **all** companies again (the earlier upserts are gone) and only then clears; `P1` never clears; `/ready` degraded throughout |
| **An older pass whose key disappears and is written again by a newer pass** with the same `incident_id` and `run_id` | `P2` creates the key with `pass_id` `P2`; every compare of `P1` fails | `P1` is superseded: it does not clear (it stops at its next renew or check; ordering W2 covers the sliver after its last check) and does not publish |
| **A worker restart in the middle of a pass** | start-up finds no sentinel; the old key expires after its TTL or is replaced; the open flag is the incident | a new pass with a new `pass_id` from step 1; the old pass is discarded; `/ready` degraded |
| **A deploy, or a rollback followed by a return to the same release A** (`run_id` unchanged, sentinel present) | every worker **process start** runs one re-certification pass (point 2): no incident, no flag; it takes ownership of the key, rebuilds, skips step 4, and publishes with step 5 | `/ready` is **degraded** while the pass is pending or failing (the worker is not yet certified), so the deploy probe waits; it turns healthy when the pass publishes. A **failed** re-certification retries with the backoff of point 5 and raises its own alert `COMMISSION_REMINDER_RECERTIFICATION_FAILED` (a distinct code, repeating each round); it opens **no** ledger incident because no loss was detected |
| **A failed re-verification** (step 3 finds the key lost or changed) | the pass deletes its key if it is still its own and stops | `/ready` degraded (incident open), a new pass after the backoff, counted as a failed round |
| **The operator fallback** (the worker cannot use the clear) | the command **first** creates the same recovery key (its own `pass_id`, the incident it names, the current `run_id`) and **then** replays `CompanyCreated`; it verifies that every company has its scheduler, aborts on any missing schedule, lost key or changed `run_id` (clearing and publishing nothing), and only then clears the incident by id (owner role, audited) and publishes with the same guarded script | the next heartbeat finds a healthy sentinel; no incident is reopened; if a worker pass owns the key the operator waits or stops that worker first; `/ready` stays degraded until the sentinel is published |

**The residual window, stated outright.** Redis and PostgreSQL are two stores and cannot be committed together. Between
the last Redis check (step 3) and the commit of the clear there is a window of milliseconds in which Redis can be lost
**after** the check but **before** the database records the clear. In that case the incident is **closed on
information that is already stale**; readiness is **not** published for the lost generation (step 5 refuses); and a
**new incident is raised at the first successful heartbeat after the connection returns**, which runs a new pass.
CS-Q32 says a loss during recovery must restart the rebuild and not close the incident; this design cannot satisfy that
to the letter for this window, and **no variant removes it**: delaying the clear until a later heartbeat only moves the
same window to after that heartbeat's check, and any rule that closes an incident in PostgreSQL on the strength of a
Redis check has it. Only a different incident contract — one that can represent «completion not yet confirmed» — would
remove it; that needs a new column and a new ledger state and is **not adopted** here. Accepting this ADR accepts the
window; question (vi) below asks Waleed for it explicitly.

**Options for an unknown clear that are not adopted.** (a) Make the clear idempotent for the same pass: the flag row
would store the clearing `pass_id` (a new column `cleared_pass_id`, granted to the clearer role) and a second call with
the same pass would return true — it removes the extra pass after an unknown outcome at the price of a new column and a
widened privilege. (b) A narrow read function over `platform_audit_log` that tells whether this `pass_id` cleared — a
new definer and a new privilege. Neither is adopted without a decision.

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
| When exhausted | never exhausted: the incident stays open, `/ready` degraded and the alert repeating until the cause is repaired | the worker stops **repairing the companies that have not recovered yet**; the flag stays open and `/ready` degraded, a distinct alert («recovery exhausted») is raised once, and nothing more is repaired until an operator restarts the worker (a new count) or runs the fallback command and the `CompanyCreated` replay. **The schedules of the companies that already succeeded keep running and keep sending reminders** |
| Risk | a permanently broken company causes endless rounds (cheap at 15 minutes) | the companies that did not recover stay without reminders until someone acts, and the incomplete recovery stays degraded |

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
database function or a company that cannot be rebuilt. They are not the primary path any more. The command **starts the
same guard before it replays** (it creates the recovery key with its own `pass_id` first, point 4), verifies every
company's scheduler, and only then clears and publishes the sentinel with the same guarded script; any lost key,
changed `run_id` or missing schedule aborts it without clearing or publishing. A successful operator recovery leaves
readiness healthy and does not reopen the incident.

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

CM-57, CM-57b, CM-57c, CM-58, CM-R09 (spec 059), and **CM-58b as its own required test** — the recipient-authorization
case of the reminders, which stays as spec 059 words it and as CS-Q52 (= PP-227) settles the recipients: an approval
reminder goes to those who can approve at that time (holders of `approve:commissions:business` who are business-wide
readers, evaluated when the reminder is appended), a review reminder to the review holders who are business-wide readers,
the alert rule's roles do not select recipients, and the recipient filter and the review and approve guards call the
same predicate. The cases below are the CS-Q32 recovery cases specific to this ADR:

- Each function refuses `PUBLIC`, `pospay_app`, `pospay_auth`, `pospay_notifications` (no `EXECUTE`); the reader returns
  ids only, only of live companies, in order, and the dispatcher still cannot `SELECT` from `companies`;
  **the dispatcher cannot insert a flag with `cleared_at` or `cleared_by` set** (permission denied).
- The clear changes nothing for an unknown id and an already-cleared id and returns false; **the id of an open incident
  of another code is not cleared and writes no audit row**; a null, a malformed `rebuilt_run_id` and a negative count are
  rejected with 22023 before any update; it never touches another flag; its audit row exists exactly when the flag was
  cleared, and a forced audit failure leaves the flag open; `pospay_dispatcher` cannot `UPDATE` or `DELETE` the flag
  table; the facade exposes no raw client.
- The life cycle of point 4 on a real Redis: the first run on an empty Redis ends healthy; a key deleted mid-pass
  restarts the pass and never clears the aborted one; **an old pass whose key disappears and is written again by a newer
  pass with the same `incident_id` and `run_id` must NOT clear and must NOT publish**; **lease takeover**: a pass that
  pauses past its TTL and returns cannot renew, update the incident id, delete the successor's key or publish; **both
  winner orderings of the race**: W1 (the key owner wins the clear, readiness restored) and W2 (a superseded pass wins
  the clear: neither publishes, `/ready` stays degraded, a new incident is raised and the new pass restores readiness
  without crediting the stale one); a clear that returns false publishes nothing and raises no flag by itself; **an
  unknown clear outcome publishes nothing, does not credit the pass from reading a closed flag and an intact key, and
  converges through a new pass**; a failed re-verification keeps `/ready` degraded; a replica that sees the sentinel
  missing between a clear and a publication raises no second incident; a loss between the guard and the clear leaves
  the sentinel missing and raises a new incident; a restart between the clear and the sentinel write raises a new
  incident and ends healthy after one more pass.
- **Re-certification**: a process start (including a rollback followed by a return to the **same** release) runs a pass,
  `/ready` is degraded until it publishes, a failing pass retries and raises `COMMISSION_REMINDER_RECERTIFICATION_FAILED`
  and opens no ledger incident.
- **The operator fallback** creates the recovery key before the replay, aborts on a lost key, a changed `run_id` or a
  missing scheduler without clearing or publishing, and on success leaves the next heartbeat healthy without reopening
  the incident.
- One failing company keeps the flag open and `/ready` degraded; under Reading B, once the cap is reached the repair of
  the unrecovered companies stops while the schedulers of the successful ones keep running.
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
- A restart at the wrong moment costs one extra pass and one extra audit row, never a missed recovery; every worker process
  start costs one re-certification pass (one idempotent upsert per company) and `/ready` is degraded until it ends.
- The split-store residual window of point 4 is an explicit exception that Waleed accepts or rejects (question vi).
- The unknown-outcome rule costs one extra pass instead of a new privilege; the options that would avoid it are described and not adopted.

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
6. **(vi) The contract for closing an incident across Redis and PostgreSQL.** The residual window of point 4: the
   incident can be closed on information that is already stale; readiness is not published for the lost generation; a
   new incident is raised at the first successful heartbeat after the connection returns. Choice 1: accept this window
   (recommended: no variant removes it, and the safety property holds). Choice 2: reject it and ask for a different
   design that meets the CS-Q32 contract (it would need a new incident state and a new column).
