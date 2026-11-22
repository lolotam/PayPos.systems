# ADR-0061 — Reminder-schedule recovery by the worker (CS-Q32): company-id read, guarded self-clear, bounded retry

- **Status:** Accepted — owner (Waleed) accepted on 2026-11-22 (CS-Q53, `docs/specs/059-commissions-statements/owner-questions.ar.md` §62: «اعتمد المقترح كاملًا، بإعادة المحاولة المستمرة وقبول نافذة الإغلاق الموضّحة.»). No 56b-1 code is written before 52-1 is merged.
- **Date:** 2026-11-22
- **Scope:** spec 059 row 56b-1, FR-053 _CS-Q32_, FR-054, FR-055, CM-57, CM-57b, CM-57c, CM-58, CM-R09.
  Owner decisions already taken: CS-Q31 (the existing `pospay_dispatcher` holds `SELECT` and `INSERT` on the flag
  table, Waleed and Abu Salem, 2026-10-23) and CS-Q32 (the worker rebuilds every company's schedule itself and clears
  its own flag only when every company succeeded, 2026-10-23, option 2, against the recommendation).
- **Owner record:** `docs/specs/059-commissions-statements/owner-questions.ar.md` §62 (CS-Q53), `ANSWERED` 2026-11-22
  in the PosPay manager thread: the whole proposal, **Reading A** (continuous retry), and the closing window of point 4
  exactly as described there (nothing wider). The six points are listed at the end of this ADR with their outcome.
- **Amends, in the 56b-1 code PR (not here):** `CLAUDE.md` §5, ADR-0003 §3, ADR-0054 §2, `docs/runbook.md`, the
  privilege inventory and the module map.

## Context

The per-company reminder schedule (the BullMQ job scheduler `commissions-statement-reminders-<companyId>`) lives only
in Redis. If Redis is lost, reminders stop silently. FR-053 requires the loss to be recorded **outside Redis** (the
append-only ledger `operational_recovery_flags`, ADR-0054 §2, code `COMMISSION_REMINDER_SCHEDULES_LOST`) and CS-Q32
requires the worker to **recover by itself**: rebuild every company's schedule and clear the flag. That needs three
things no runtime role has today: (1) a read that spans all companies (`CLAUDE.md` §5 allows only the outbox
dispatcher on `outbox`; ADR-0038 allows the migration owner to read `companies.id` during `migrate` only); (2) a
**clear** (CS-Q31 gave `pospay_dispatcher` only `SELECT` and `INSERT`); (3) an **audit path** for the clear
(`platform_audit_log` is written today only by `pospay_auth` and owner-role scripts). Each touches "there is no fifth
way to reach tenant data" (`CLAUDE.md` §5, ADR-0003), so it needs Waleed's acceptance before any code.

**Who is responsible for what.** The database functions enforce **scope and atomicity only**: which rows they may read
or change, that a clear happens once, for one incident of one code, together with its audit row, and that arguments
have the right shape. They cannot see Redis. **Verifying Redis and the completeness of the rebuild is the worker's
responsibility**; the definer never treats its arguments as proof of recovery.

## Decision

### 1. Two definer functions, two function-owner roles, one caller

Pattern of ADR-0012 §2 and ADR-0013: a function-owner role per function, `NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT
NOCREATEDB NOCREATEROLE NOREPLICATION`, member of no role, owning exactly one function and nothing else. The caller of
both is `pospay_dispatcher` through the existing facade `createOutboxDispatcherDatabase`; no new login role, pool, URL
or secret.

| Function | Owner role | Returns | Reads / writes |
| --- | --- | --- | --- |
| `public.recovery_company_ids(after_id uuid, page_size integer)` | `pospay_recovery_company_reader` | one page of company ids, ascending, `page_size` clamped to 1…1000; only live companies are visible to the role (the RLS policy below) | `SELECT (id)` on `companies`; the body selects, filters by the cursor and orders on `id` only and reads no other column |
| `public.clear_reminder_schedules_lost_flag(flag_id uuid, rebuilt_run_id text, rebuilt_pass_id uuid, companies_rebuilt integer, audit_id uuid)` | `pospay_recovery_flag_clearer` | `boolean`: true when this call cleared the flag | `UPDATE (cleared_at, cleared_by)` on `operational_recovery_flags`; `INSERT` on `platform_audit_log` |

Both: `SECURITY DEFINER`, not `LEAKPROOF`, `SET search_path = pg_catalog, pg_temp`, `SET row_security = on`, qualified
names, fixed SQL, `REVOKE ALL … FROM PUBLIC, pospay_app, pospay_auth, pospay_notifications, pospay_suppression_reader,
pospay_approval_reader`, one `GRANT EXECUTE … TO pospay_dispatcher`; ownership transferred and grants made in the same
migration transaction, with no schema `CREATE` left on the owner roles. Effective privileges are asserted.

| Grantee | Exact privilege |
| --- | --- |
| `pospay_recovery_company_reader` | `USAGE ON SCHEMA public`; `SELECT (id) ON public.companies`; policy `companies_recovery_select … TO pospay_recovery_company_reader USING (deleted_at IS NULL)` — **the only place `deleted_at` is referenced**; the role has no `SELECT (deleted_at)` grant and the function does not filter on it (`companies` has forced RLS with policies for `pospay_app` only, migration 0002; this is a role-scoped exception like ADR-0003's for the dispatcher on `outbox`) |
| `pospay_recovery_flag_clearer` | `USAGE ON SCHEMA public`; `SELECT, UPDATE (cleared_at, cleared_by) ON public.operational_recovery_flags`; `INSERT ON public.platform_audit_log` |
| `pospay_dispatcher` (CS-Q31, narrowed) | `SELECT` and **`INSERT (id, code, raised_at)`** on `operational_recovery_flags` (a column-level `INSERT`: it can raise a flag, never insert one already cleared); `EXECUTE` on the two functions |

**`pospay_dispatcher` can:** list ids of live companies (id only), raise a flag, list flags, clear one named incident of
the reminder code once. **It cannot:** read any other company column, any tenant table or `platform_audit_log`; insert a
cleared flag; `UPDATE`, `DELETE` or `TRUNCATE` the flag table; clear another code's flag, in bulk or twice; write an
audit row of its own shape. No runtime role gains `BYPASSRLS`.

**Argument validation.** The clear function rejects, before any update, a null argument, a `rebuilt_run_id` that is not
the 40-character lowercase hex of a Redis `run_id` and a negative `companies_rebuilt`, with `invalid_parameter_value`
(22023): metadata shape, not verification of recovery.

### 2. (a) The narrow read of company ids, and what it guarantees

The worker pages `recovery_company_ids` until a short page; it never sees a name or a tenant row. Each company is
handled alone: the rebuild upserts the BullMQ scheduler from the id (job data `{ companyId }` only, outside any
transaction, FR-053); the reminder job it schedules later reads the company's businesses under `withTenant` as
`pospay_app`.

**Consecutive keyset pages are not a snapshot** (each is its own READ COMMITTED statement), so the pass states exactly
what it certifies. **The cut-off rule, in three lines:**

1. **The cut-off `C` is the PostgreSQL `clock_timestamp()` read just before the pass's last listing starts**, a listing
   that adds nothing new: every id it returns was already rebuilt (the pass lists from the start up to five times; if the
   fifth listing still adds a company the round fails and the next slot retries). A
   statement that begins after `C` sees every company whose creating transaction committed before `C`, so **the pass
   certifies exactly the companies committed before `C`**, whenever they were created or whatever their id order.
2. **A company committed after `C` is not part of this certificate.** It is covered by the worker `commissions`
   consumer of `CompanyCreated` that 56b-1 registers (FR-053, ADR-0037 precedent; the module map's `CompanyCreated` row,
   consumed today by `staff`, gains `commissions`), the same as a company created a day after any recovery.
3. **The consumer's failure is never silent.** The sentinel records `C`. A `CompanyCreated` event of the outbox that
   **parks after `C`** (its deliveries ran out) makes `/ready` degraded, raises the alert
   `COMMISSION_REMINDER_COMPANY_SCHEDULING_PARKED` and starts a new automatic pass (point 4); that pass lists every
   company again, so a parked delivery never leaves a company unscheduled for good, and its new `C` is later than the
   park. A delivery still being retried is not a failure yet; it is repaired by its own retry.

**The consumer's registration** follows the ADR-0037 pattern. The Redis upsert of the scheduler runs **outside the
database transaction and before the consumer's dedupe mark** (`markEventConsumed`, `apps/worker/src/outbox/deliver.ts`,
which the deliverer calls inside `withTenant`): a Redis failure is a retryable delivery outcome, so **nothing is marked**
when the registration fails and **the retry sees an unmarked event** and registers again (the upsert is idempotent). Only
a successful registration is followed by the mark. A parked event keeps its row (`parked_at`, `last_error`), which is what
the sentinel check above reads: no new table, role or grant (the dispatcher already reads and marks `outbox`, ADR-0003
§3). The pass's own rebuild is the same idempotent upsert and takes no mark at all.

- **A single scheduler lost while the Redis process and the sentinel survive is out of scope of this ADR** (it is not a
  recovery event). It is repaired by every `commissions.project-inputs` delivery (FR-053, CM-57b) and by the next process
  start; a periodic coverage check is tracked as a follow-up (the issue is linked under «Known limits»), not decided here.
- **Rollout and rollback.** An older worker that does not know the consumer can acknowledge `CompanyCreated` without
  scheduling. So the first certifying pass starts only after previous-version workers have stopped, and **every worker
  process start runs a pass** (point 4) whatever the release: a rollback followed by a return to the same release is a
  new process start and is re-scanned.

### 3. (b) The clear

After argument validation, `clear_reminder_schedules_lost_flag` runs `UPDATE operational_recovery_flags SET cleared_at =
now(), cleared_by = <system identity> WHERE id = flag_id AND code = 'COMMISSION_REMINDER_SCHEDULES_LOST' AND cleared_at
IS NULL` and, only if a row changed, inserts one `platform_audit_log` row: `actor = 'system:worker'`, `action =
'recovery.flag_cleared'`, `details = { flag_id, code, rebuilt_run_id, rebuilt_pass_id, companies_rebuilt }`, `audit_id`
from the worker's injected `IdGenerator`. No row changed (unknown id, **another code**, already cleared) → no audit,
returns false. A failed audit insert rolls back the clear. `cleared_by` is the constant uuid
`00000000-0000-7000-8000-000000000061` (in `packages/db`, no foreign key, ADR-0054 §2's CHECK still holds); the operator
command keeps its own identity.

### 4. (c) One key, one rule, one pass

**Two Redis keys.**

| Key | Meaning | Value |
| --- | --- | --- |
| **recovery key** `commissions:reminders:recovery` | "this pass owns the recovery": lease and marker in **one** key with a 120 s TTL | `{ incident_id, run_id, pass_id }`: the incident (null until known), the Redis `run_id` at the start (`R0`), a unique `pass_id` (UUID v7 from the injected `IdGenerator`, new for every pass) |
| **readiness sentinel** `commissions:reminders:sentinel` (FR-053) | "this generation was fully rebuilt and verified for the companies committed before `cutoff`" | `{ release, run_id, pass_id, cutoff }`: the `pass_id` of the pass that published it and its cut-off `C` (point 2); the release is diagnostic only |

**The one rule: ownership is checked immediately before every shared write, and a pass that fails the check stops and
does nothing else.** The shared writes are the incident-id update of the key, raising the flag, the clear, and the
publication; the rebuild's scheduler upserts are idempotent and need no check. The check is a compare-and-set on the
same `pass_id` in one Redis script (renew, update, delete, publish are all such scripts; nothing is an unconditional
write or delete); creation is `NX`. A key lost to TTL or a flush means ownership is lost. The lease only keeps replicas
from duplicating work; correctness rests on the `pass_id` compare.

**Detection and readiness (one rule: the incident wins).** Recovery is **needed** when the sentinel is missing or its
`run_id` differs from the server's, **or a flag of the code `COMMISSION_REMINDER_SCHEDULES_LOST` is open**, **or a
`CompanyCreated` event has parked after the sentinel's `C`** (point 2), and at every worker process start. **Every read
and every adoption here is restricted to that one code**: a flag of another code never triggers this recovery, is never
adopted, never invalidates the reminder sentinel and is never sent through the clear function (which refuses it anyway,
point 3); `/ready` still reports it degraded as an incident of the worker, and its own owner repairs it. **`/ready` is healthy only
when the sentinel is valid, no recovery key exists and no flag is open**, read in one fixed order so that observations
on opposite sides of a clear or of a late insert are never combined (no new store). The probe does three things:
**(i)** an **atomic Redis snapshot** of the sentinel, the recovery key and the server's `run_id`; **(ii)** the read of
the open incidents in PostgreSQL; **(iii)** a **final atomic Redis check** of the same three. «Atomic» means a Lua
script or a `MULTI`/`EXEC` transaction, as Redis documents under
[transactions](https://redis.io/docs/latest/develop/using-commands/transactions/); a plain pipeline is not atomic. It
reports healthy only if **(i)** showed a valid sentinel (its `run_id` equals the server's) and no recovery key, **(ii)**
found no open incident of the reminder code and no `CompanyCreated` event parked after the sentinel's `C` (one
statement through the dispatcher facade, `C` taken from (i)), and **(iii)** confirms **the same certificate** (the same `pass_id` and `run_id` as in (i)), a
`run_id` equal to the server's, and no recovery key. A new certificate between (i) and (iii) therefore makes this probe
degraded (it was published by a real recovery, and the next probe is healthy); an incident that raises, invalidates the
sentinel and clears, then stops or crashes before publishing, leaves the sentinel absent at (iii). **The probe's
result applies to the moment of the PostgreSQL read (ii), with the Redis certificate proven stable around it (the same
certificate, the same `run_id` and no recovery key at (i) and at (iii)); an incident opened after that moment is
reflected by the next probe, and the result is not a guarantee that extends to the final Redis check or to the moment
the response is sent.**
A valid sentinel together with an open incident does not make the worker ready. The recovery and the close stay **automatic** (CS-Q32): a new pass adopts the open incident, re-verifies
every company's scheduler and closes it by the normal path (clear, then publish); the operator command is only the
fallback. A pass has an incident iff it finds a loss: a missing or stale
sentinel, an open flag **of the reminder code**, a changed `run_id`, or — in the start-up pass — **any company without
its scheduler** (this is also CM-57b's first-deploy case). A pass that finds none (including one started by a parked
`CompanyCreated`) is a plain re-certification, with no ledger incident.

**One pass.**

1. **Own.** Create the key (`NX`); if it exists another pass owns it: wait and re-detect later, raise nothing.
2. **Decide the incident, under ownership.** Re-read the sentinel and the open flags **of the reminder code only**:
   nothing needed → delete the key and stop; an open flag of that code → adopt its id; a loss → `INSERT … ON CONFLICT DO
   NOTHING` raises the flag (one open flag per code), `/ready` turns degraded, the alert is raised. **When the insert
   returns no row (another insert won the conflict, for example a superseded pass's late insert), the pass reads the open
   flag of the reminder code in a fresh statement and adopts that id under the same ownership guard; if that flag has
   already been cleared, it re-runs detection from the start of this step.** A re-certification with no loss continues
   without incident. Update the key's `incident_id`. **When the pass adopts or raises an incident and a sentinel still exists, it
   invalidates the sentinel first — a guarded delete (only if the key holds this `pass_id`) — before the clear path.** An
   old valid sentinel therefore can never outlive the incident it predates: whatever the clear then does (true, false,
   unknown, or a superseded winner), `/ready` returns to healthy only after a new publication.
3. **Rebuild** every company (point 2). **Renew the key on a time basis while working, not after a whole page**: a
   timer renews under the ownership guard **at most every third of the TTL (40 s of the 120 s)**, and also before each
   page, so a page of up to 1000 companies slower than the TTL does not lose the key; **every renewal also re-checks
   that the server's `run_id` is still `R0`**. **A renewal is not progress: the renewal only holds the key while the work
   advances.** Every page read and every scheduler upsert has its own deadline (a page 30 s, an upsert 10 s), and the pass
   has a **maximum interval without progress of 90 s** (progress = a page returned or an upsert completed). When an
   operation passes its deadline, or the interval ends, the pass **stops renewing, deletes its own key by
   compare-and-set** and ends as a failed round; the next slot of point 5 starts a new pass, so a stalled read or upsert
   never keeps the other replicas or the operator locked out beyond the interval plus one TTL.
   - **A changed `run_id`, a failed renew or a lost key ends the pass at once, even mid-page and even if the key is
     still there** (the company in flight finishes or aborts and no further upsert or shared write is made; the upserts
     already done are idempotent and harmless) (Redis can restore
     it from persistence after a restart, so «the key still holds my `pass_id`» is not enough): the pass stops, **deletes
     its own key by compare-and-set** (the delete is the one that frees it at once; if the worker is dead the 120 s TTL
     does), and does not clear or publish. The next detection starts a **new pass** — fresh `R0`, new `pass_id`, the key
     taken by `NX` create — which needs no mechanism beyond the operations above.
   - **A missing scheduler found while ownership and `R0` still hold** is the only conversion: a re-certification that
     finds one continues as an incident recovery under the same key (step 2: raise or adopt, invalidate the sentinel).
4. **Before the clear**, the same ownership and `run_id` check. Then call the clear (incident passes only); no incident
   → skip.
   - **true** → step 5. **false** (already cleared elsewhere, or not this code's) → publish nothing, delete the key,
     stop. **unknown** (timeout, lost response) → **treated as not-mine**: publish nothing, delete the key, stop; the
     flag is not read to credit this pass (a closed flag plus an intact key cannot prove this pass committed).
   - A false or unknown answer never raises a flag by itself; the next detection decides.
5. **Publish**, guarded in one Redis script: write the sentinel `{ release, run_id: R0, pass_id, cutoff: C }` only if the key still holds
   this `pass_id` and incident and the server's `run_id` is still `R0`, and delete the key in the same script.

Every stop leaves `/ready` degraded while an incident is open or the sentinel is not healthy; a worker that has not yet
completed its start-up pass is also degraded, so the deploy probe waits. A failing incident-free pass retries on the
schedule of point 5 and raises its own alert `COMMISSION_REMINDER_RECERTIFICATION_FAILED` (no ledger incident: no loss
was found).

**The race between the clear and the publication.** The clear is one `UPDATE`; exactly one call changes the row.

| Ordering | Outcome |
| --- | --- |
| **W1** — the key owner wins | true; step 5's guard holds; published; credited to this pass (`pass_id` in the audit row) |
| **W2** — a pass that lost the key after its last check wins | its call is true but step 5's compare fails: it publishes nothing; the owner's call is false: it publishes nothing and deletes its key. **Neither publishes**; the sentinel was invalidated at step 2 and the flag is closed, so the next detection raises a new incident and a new pass certifies the generation, never crediting the stale one |

**Walk-through (an open incident or any mismatch keeps `/ready` degraded in every case):**

| Case | Outcome |
| --- | --- |
| **First run on an empty Redis** | every scheduler missing → incident `I1` raised and adopted under the key; full rebuild; clear true; publish; `/ready` healthy |
| **Key lost mid-rebuild, same `run_id`** (a `FLUSHDB`; earlier upserts are gone) | the next renew fails → the pass stops; a new pass (new `pass_id`) rebuilds **all** companies and only then clears |
| **`run_id` changed mid-pass, the key still present** (Redis restarted and restored the key from persistence) | the next check sees `run_id` ≠ `R0`: the pass stops and deletes its own key; a new pass with a fresh `R0` and `pass_id` creates the key and rebuilds **all** companies; the old pass never clears or publishes |
| **`run_id` changed mid-pass, the key lost** | the renew fails → the pass stops; the same new pass follows (a key left by a dead worker is taken after its TTL) |
| **Takeover:** P1 stops renewing, the TTL lapses, P2 creates the key | P1's every later check fails: it raises, clears and publishes nothing; if P1 was already past its last check it may win the clear (W2) but cannot publish |
| **Restart mid-pass / between the clear and the publish** | no sentinel at start-up → detection takes ownership and finds either the open flag (adopted) or a closed one (a new incident); one more full pass |
| **Deploy, or a rollback and return to the same release** | the process start runs a pass; all schedulers present → re-certification, no incident; missing ones → incident recovery in the same pass |
| **An open flag with a valid sentinel** (for example a stale insert that landed after a newer pass had published, because the ownership check and the PostgreSQL insert are not atomic) | `/ready` stays degraded (the incident wins); a new pass adopts the incident, invalidates the old sentinel, re-verifies every company's scheduler, clears it and publishes; readiness returns only then |

**The residual window.** Redis and PostgreSQL cannot be committed together. Between the last Redis check (step 4) and the
commit of the clear, Redis can be lost. Then the incident is **closed on information that is already stale**; readiness
is **not** published for the lost generation (step 5 refuses); and a **new incident is raised at the first successful
heartbeat after the connection returns**. CS-Q32 says a loss during recovery restarts the rebuild without closing the
incident; this window cannot satisfy that to the letter, and **no variant removes it** (delaying the clear only moves
it; any rule that closes an incident in PostgreSQL on a Redis check has it). Removing it needs a new incident state
(«completion not confirmed») and a column: **not adopted**. Question (vi) asks Waleed to accept or reject it.

### 5. (d) The retry — the state belongs to the incident

While a flag is open: `/ready` degraded; the alert `COMMISSION_REMINDER_SCHEDULES_LOST` is raised on every start and
repeats on every round. **The retry state lives in the incident, not in the pass.** Its anchor is the flag row's
`raised_at` (no new column): rounds are time slots of one schedule counted from `raised_at` — 1, 3, 7 and 15 minutes
after it, then every 15 minutes. A pass starts a round only when the next slot is due, so a new `pass_id`, a takeover or
a process restart **continues the same schedule**; which companies still fail is recomputed by each pass (upserts are
idempotent). **After a restart or a takeover the interval is derived from `raised_at` alone, as the elapsed slots,
downtime included:** the new worker computes the latest slot that is already due and starts a round for it
at once (it cannot tell whether an earlier pass already ran that slot, and one extra round is harmless), then waits for
the next slot. **A slot is a pace,
not an attempt count:** under Reading A (no cap) the schedule only decides when the next round runs and never exhausts the
retries; a long downtime shortens the next wait, it never ends the repair. A new incident starts a new schedule; an incident-free pass is anchored on its process start.

The owner record («عدد محاولات محدود») and FR-053 («bounded backoff») can be read two ways. **Waleed chose Reading A on
2026-11-22 (CS-Q53, point 2, «بإعادة المحاولة المستمرة»); Reading B is kept below only as the accurate description of the
alternative that was not chosen:**

| | **Reading A — a cap on the wait, none on the number of rounds** (adopted) | **Reading B — a wall-clock repair deadline from `raised_at`, downtime included** (not chosen) |
| --- | --- | --- |
| What matters | only the wait schedule above | a **wall-clock repair deadline measured from `raised_at`**, downtime included: it is **not a count of attempts actually made**, because slots elapse even if no worker was running; a worker that was down until after the deadline returns with the repair already closed, having made no attempt |
| When exhausted | never: the incident stays open, `/ready` degraded, the alert repeating | once the deadline passes (e.g. 10 slots, 1 hour 45 minutes after `raised_at`) the worker stops **repairing the companies that have not recovered yet**; the flag stays open, `/ready` degraded, a distinct alert «recovery exhausted» is raised once per process start; only the operator fallback ends it. **The schedules of companies that already succeeded keep running and sending reminders** |
| Risk | a permanently broken company causes endless rounds (cheap at 15 minutes) | the unrecovered companies stay without reminders until someone acts, and the recovery stays degraded |

Counting the attempts actually made (so that downtime does not consume them) needs durable accounting of every attempt
(a new column or table); **it is not part of this ADR and was not chosen.** **Adopted: Reading A** (Waleed, 2026-11-22).
Because the schedule is anchored on `raised_at` alone, a successor cannot tell whether an earlier pass already attempted
the current slot, and does not need to: a pass that starts in a slot that is due runs, and one extra attempt in a slot is
harmless (the upserts are idempotent).

### 6. (e) Clear only when every company succeeded

The flag clears only in a pass in which **every** company the pass read succeeded (including one created mid-pass that a
later page or listing read) and the guards held. One failed company keeps the flag open, `/ready` degraded, the alert
repeating (Waleed's note, owner-questions §32). The certificate covers the companies committed before `C` (point 2);
companies after `C` are the consumer's, and their failure to register shows as the parked-event check of point 4, never
as a silent gap. **CM-57c:** a quiet business is part of the pass like any other: its scheduler is rebuilt from the id, and on
its next run the reminder job creates the `DRAFT` row through `lockStatementPeriods`, writes the ledger entry
`commission_statement_reminders` and sends the reminder; a company whose `commissions` feature is off still gets its
scheduler (the job ends without writing, FR-053).

### 7. Fallback: the operator command

For a worker that cannot reach the database function or a company that cannot be rebuilt. It runs as the owner role and
**does not depend on outbox consumer marks**: it **first creates the same recovery key** (its own `pass_id`, the incident
it names, the current `run_id`); then lists every company id (the owner reads `companies.id`, the same list as the
definer's) and verifies each company's scheduler, **upserting the missing ones itself with the same idempotent upsert**;
**while it lists and upserts it renews the key under the same ownership guard and on the same time basis as the worker
(at most every third of the TTL, each renewal re-checking that the server's `run_id` is still `R0`)**, so a scan longer
than the TTL does not lose the key; **it uses the same per-operation deadlines and the same maximum interval without
progress as the worker (point 4, step 3), so a stalled read or upsert ends the scan, frees the key by compare-and-set and
clears nothing**; it aborts at once on a failed renewal, a lost key, a changed `run_id` or a failed upsert (clearing and
publishing nothing). **Like the worker
(step 2 of point 4), once it adopts or names the incident it invalidates an existing sentinel with the same guarded
delete, before it clears**: an abort or a crash after the clear then leaves the sentinel absent and `/ready` degraded,
never healthy on the old certificate. Only then does it clear the incident by id (audited) and publish the sentinel
with the same guarded script. A worker pass that owns the key
makes the operator wait or stop that worker first. Replaying `CompanyCreated` is no longer part of this primary path: it
stays a documented secondary tool (a consumer's mark in `consumed_events` makes a replay skip a company, so it can never
be relied on to rebuild).

## What the code PR must amend

`CLAUDE.md` §5 (the dispatcher also reads company ids through one definer, clears one named flag through another and
inserts flags by column; both recorded as exceptions beside the outbox dispatcher and the migration data step); ADR-0003
§3 (the `pospay_dispatcher` row, the two owner roles, a section «global operational flags»); ADR-0054 §2 (_Access_ and
_Clearing_ point here; `INSERT (id, code, raised_at)`); `docs/runbook.md` (automatic recovery first, the operator command
as fallback, the two keys, the rollout rule); `packages/db/src/roles.ts`, `dispatcher.ts` (`raiseRecoveryFlag`,
`openRecoveryFlags`, `companyIdPage`, `clearRecoveryFlag`); the privilege inventory (`function-inventory.ts`,
`table-grants.ts`, `privileges.spec.ts`: attributes, ownership of exactly one function each, no schema `CREATE`,
effective privileges); the module map (the worker `commissions` recovery reader and the `CompanyCreated` consumer row); the dispatcher facade's
read of `outbox.parked_at` and `event_type` for the parked-event check (the role already reads and marks `outbox`; the code
PR confirms the column grants and adds nothing else); the sentinel's `cutoff` field and the alert
`COMMISSION_REMINDER_COMPANY_SCHEDULING_PARKED` in `docs/runbook.md`.

## Tests the code PR must carry

CM-57, CM-57b, CM-57c, CM-58 and CM-R09 as spec 059 words them, and **CM-58b as its own required test, unchanged**:
spec 059 says CM-58b proves that a manager with `review:commissions:business` and `approve:commissions:business` but
branch scope, and a business manager with a DENY of `read:commissions:business` on a branch, receive none of the day-3
`StatementAwaitingReview`, the 3rd/5th and review-time `StatementAwaitingApproval` notices, that the owner and a
business manager with no DENY do, that an accountant with a DENY of `approve:commissions:business` gets the review
notices but no approval ones, and that **the recipient filter and the review and approve guards call the same
predicate** (FR-030). This ADR restates nothing beyond it: recipients stay as DR-003 (`AlertRulesPort`) and DR-008 /
CS-Q52 = PP-227 settle them (approval reminders to those who can approve; Abu Salem's pick on batch 100 is pending and
binds if it differs).

Recovery cases (CS-Q32), each with its own expected result:

- **Privileges:** the reader role has no `SELECT (deleted_at)` and the function reads only `id` (deleted companies are
  absent through the policy); each function refuses `PUBLIC`, `pospay_app`, `pospay_auth`, `pospay_notifications`; the reader returns
  ids only, live companies, in order; the dispatcher cannot `SELECT` from `companies` nor insert a flag with
  `cleared_at`/`cleared_by` set, nor `UPDATE`/`DELETE` the flag table; the facade exposes no raw client.
- **Clear function:** unknown and already-cleared ids return false; **an open incident of another code is not cleared and
  writes no audit row**; null, malformed `rebuilt_run_id` and negative count fail with 22023; the audit row exists exactly
  when the flag was cleared; a forced audit failure leaves the flag open.
- **Ownership, real Redis, with explicit barriers:** (a) **takeover before the pre-clear check** — a pass that pauses
  past its TTL and returns cannot raise, update the incident id, clear, delete the successor's key or publish; (b)
  **W1** — the key owner wins the clear: published, credited, `/ready` healthy; (c) **W2** — a successor takes the key
  **after** the old pass's last check and the old pass wins the clear: neither publishes, `/ready` stays degraded, a new
  incident is raised and the new pass restores readiness; **(c1) adoption with a valid old sentinel followed by a `false`
  or `unknown` clear never returns `/ready` to healthy without a new publication; (c2) the same with a superseded
  winner (W2)**; (d) an old pass whose key disappears and is rewritten by a
  newer pass with the same `incident_id` and `run_id` never clears or publishes before its last check; (e) **a pass
  paused before the flag insert until a successor has published** lands its insert after the successor has published, leaving an
  open flag with a valid sentinel: `/ready` is degraded, a new pass adopts that incident, re-verifies every company's
  scheduler and closes it by the normal path, and readiness returns only then.
- **Clear outcomes:** false publishes nothing and raises nothing; **unknown publishes nothing, does not credit the pass
  from a closed flag and an intact key**, and converges through a new pass.
- **Life cycle:** first run on empty Redis ends healthy; key lost mid-pass restarts the pass; a loss between the guard
  and the clear leaves the sentinel missing and raises a new incident; a restart between clear and publish raises a new
  incident and ends healthy after one pass; a replica that sees the sentinel missing between a clear and a publication
  raises no second incident.
- **Readiness reads** (the probe's three steps i, ii, iii): **(a)** a late incident insert that lands after the first
  snapshot and before the incident read → degraded; **(b)** a late insert that commits after (ii), whether before or
  after (iii): this probe does not see it (healthy for the moment of (ii)); the **next probe is degraded**, and the
  incident then wins as point 4 defines; **(c)** a clear followed by
  a crash before the publish, interleaved between the steps → degraded (sentinel absent at iii); **(d)** a completed
  recovery that publishes a new certificate between i and iii → degraded on this probe (the certificate changed),
  healthy on the next; an open flag with a valid sentinel and no key → degraded.
- **Renewal:** **a page slower than the TTL does not lose the key** (renewals every ≤ TTL/3 while working, each
  re-checking `run_id` = `R0`); **a failed renewal mid-page stops the pass at once** with no further upsert or shared
  write.
- **Retry (Reading A):** across successive `pass_id`s, takeovers and restarts the schedule continues from `raised_at`
  and never ends while the incident is open; a pass that starts in a due slot runs even if an earlier pass already
  attempted it.
- **Start-up:** a process start (also after a rollback to the same release) runs a pass; `/ready` is degraded until it
  publishes; a missing scheduler found while ownership and `R0` hold turns it into an incident recovery under the same
  key; **a changed `run_id` during the scan, with the key still present or lost, stops that pass without clearing or
  publishing and a new pass (fresh `R0`, new `pass_id`) recovers the incident**; a failing incident-free pass retries and
  raises `COMMISSION_REMINDER_RECERTIFICATION_FAILED` with no ledger incident.
- **Operator fallback:** creates the key before it touches any scheduler; **an old valid sentinel is invalidated before
  the clear, and an abort or a crash after the clear leaves `/ready` degraded**; with an already-consumed `CompanyCreated`
  event and a missing scheduler it still restores the scheduler; **ownership lost during the operator's scan (a failed
  renewal, a lost key) aborts it without a clear or a publication; a scan longer than the TTL does not lose the key**;
  aborts on a changed `run_id` without clearing or publishing; on success the next heartbeat is healthy and no incident reopens.
- **Coverage and the cut-off `C`:** a company created between two pages ends with a scheduler — one the pass reads
  (counted), one it does not read (id below the cursor; after the last page, via the `CompanyCreated` consumer); a quiet
  company is part of the pass (CM-57c); **a quiet company committed after `C` whose `CompanyCreated` registration fails
  until the outbox parks it: `/ready` is degraded, `COMMISSION_REMINDER_COMPANY_SCHEDULING_PARKED` is raised and a new pass
  (new `C`) schedules it; a delivery still being retried does not degrade readiness**; a company committed before `C` is
  always read by the last listing.
- **Consumer registration (ADR-0037 pattern):** the upsert runs outside the transaction and before the dedupe mark; a Redis
  failure leaves **no mark** and the retry registers again; success is followed by the mark.
- **Code-restricted detection:** **an open flag of another code neither triggers a rebuild, nor is adopted, nor
  invalidates the reminder sentinel**, and a reminder pass does not call the clear function for it; `/ready` still reports
  it degraded.
- **Adoption after a conflicting insert:** **when the insert returns no row because a superseded pass's late insert
  committed after the current owner's read and before its insert, the owner reads the open flag in a fresh statement and
  adopts it under the guard; if it was already cleared meanwhile, detection re-runs.**
- **Stalled work:** **a page read or an upsert that does not return past its deadline, with Redis still answering the
  renewals, ends the pass, frees the key and lets the next round retry; the same for the operator scan; the key is never
  held beyond the maximum interval without progress plus one TTL.**

## Alternatives considered

- **A column `UPDATE` grant on the flag table to `pospay_dispatcher`:** the runtime could clear any flag by any id; the
  definer fixes the incident, the code, the one-time effect and the audit row. (ADR-0054 §2, D-24.)
- **A new login role `pospay_recovery`:** a pool, an env URL and a secret; CS-Q31 chose the existing role.
- **`BYPASSRLS`; owner-owned definers:** no runtime role has it; the owner is the bootstrap superuser, exact grants on
  owner roles are smaller and auditable.
- **A real snapshot of the company list:** a long cross-tenant transaction or a new table; the coverage rule gives the
  same result with the consumers that exist.
- **Reading company ids from `outbox` events; operator-only recovery:** only the dispatcher reads `outbox`, old events
  may be gone; operator-only is superseded by CS-Q32.

## Known limits and follow-ups

- **The residual window of point 4** (question vi): **accepted by Waleed on 2026-11-22 exactly as described in point 4**
  (the incident can close on a Redis check that is already stale; readiness is never published for the lost generation and
  a new incident is raised at the first heartbeat after the connection returns). It is not widened by anything else in this
  ADR: the cut-off, the parked-event check and the retry add no closing path.
- **A single lost scheduler with a surviving Redis process and sentinel** is out of scope here; periodic verification of
  scheduler coverage is tracked in [issue #1220](https://github.com/lolotam/PayPos.systems/issues/1220).
- **A pause between the ownership check and the flag insert** can still let a superseded pass insert an incident after a
  successor has published: the check immediately before the write narrows the window and cannot close it across two
  stores. This does **not** break the contract, because the reconciliation of point 4 (the incident wins) is defined: it
  costs one extra pass and one extra audit row, with `/ready` degraded meanwhile and the close still automatic.
- **An unknown clear costs one extra pass** (and an extra audit row if it had committed). Not adopted, because each needs
  a new privilege or column: (a) a `cleared_pass_id` column making the clear idempotent for the same pass; (b) a read
  function over `platform_audit_log` that tells whether this `pass_id` cleared.
- **Every process start costs a pass** (one idempotent upsert per company) and a degraded `/ready` until it ends.

## Technical questions for Waleed: answered 2026-11-22

Recorded in `owner-questions.ar.md` §62 (CS-Q53), `ANSWERED`: «اعتمد المقترح كاملًا، بإعادة المحاولة المستمرة وقبول نافذة
الإغلاق الموضّحة.» (the PosPay manager thread, 2026-11-22). The whole proposal, each point as proposed:

1. **(i) Function-owner roles:** two (the recommendation).
2. **(ii) Retry:** Reading A, continuous retry; Reading B is not adopted and appears in point 5 only as the accurate
   alternative.
3. **(iii) Page size:** 1000 ids per page (clamped 1…1000).
4. **(iv) The fixed system identity:** `00000000-0000-7000-8000-000000000061` as `cleared_by`, no foreign key.
5. **(v) The audit texts:** `actor = 'system:worker'`, `action = 'recovery.flag_cleared'`.
6. **(vi) The closing window across Redis and PostgreSQL (point 4):** accepted as described there (choice 1), and only
   as described: no wider exception.
