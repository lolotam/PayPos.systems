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
what it certifies. **One protocol for the cut-off `C`, the same for the worker and for the operator command (point 7):**

1. **`C` is read first, from PostgreSQL, in a statement of its own** (`SELECT statement_timestamp()`), and **one complete
   listing follows, every page statement of which starts after that statement has ended.** Under READ COMMITTED a
   statement sees every transaction that had committed when its snapshot was taken, and snapshots only move forward, so
   **every page sees every company that was committed before the snapshot of the `C` statement, including one committed
   behind the cursor's id** (UUID v7 is time-ordered but API instances can skew). A company that commits after that
   snapshot may or may not be returned by the listing; if it is, it is rebuilt like any other (harmless, and counted);
   if it is not, it is not part of the certificate. The listing is one keyset pass that ends at a short page: it has no
   «repeat until nothing new» condition, so steady onboarding cannot keep it from finishing.
2. **The pass certifies exactly the companies committed before `C`, and it publishes (and clears) only after every
   company the listing returned has succeeded.** The sentinel records `C`. A company committed after `C` is covered by the
   worker `commissions` consumer of `CompanyCreated` that 56b-1 registers (FR-053, ADR-0037 precedent; the module map's
   `CompanyCreated` row, consumed today by `staff`, gains `commissions`), the same as a company created a day after any
   recovery.
3. **The consumer's failure is never silent: the predicate P.** `CompanyCreated` has two consumers (`staff` and
   `commissions`) and the dispatcher parks the **whole event** (`apps/worker/src/outbox/deliver.ts`), so a park alone does
   not say which consumer failed. **P(C) is true when a `CompanyCreated` event has parked after `C` and the commission
   scheduler of that event's company does not exist in Redis.** A park after which the scheduler exists (the `staff`
   consumer failed) makes P false: no degradation, no alert, no pass. When P is true, `/ready` is degraded, the alert
   `COMMISSION_REMINDER_COMPANY_SCHEDULING_PARKED` is raised, and detection starts a pass (point 4) whose new `C'` is
   later than the park. A delivery still being retried is not a failure yet.

**Which clock orders `C` and `parked_at`.** Both are the clock of the one PostgreSQL server: the dispatcher sets
`parked_at = clock_timestamp()` when it parks an event (`packages/db/src/dispatcher.ts`), and `statement_timestamp()` is
taken when the `C` statement starts, **before** its snapshot. A company that the snapshot did not see committed after it,
hence after `C`; its event is delivered only after that commit and parks later still, so its `parked_at > C`. (A failover
to a host with a different wall clock is outside this ordering; the next process start's pass repairs it.) P reads the
parked events through the dispatcher facade (`outbox`, which the role already reads, ADR-0003 §3) **in one statement
that fetches up to 101 candidates and returns at most 100 company ids plus an overflow bit** (set when the 101st row
exists). **Overflow fails closed: P is true (degraded) and a pass starts**; exactly 100 parked rows are not an overflow,
and all 100 are checked.

**What P reads, and why no grant is needed.** The scheduler's existence is the fact that matters; a mark in
`consumed_events` would only say that a registration once succeeded. The dispatcher cannot read that table at all: only
`pospay_app` can, per company and under `withTenant` (migration 0006: `GRANT SELECT, INSERT ON consumed_events TO
pospay_app`, the dispatcher holds `outbox` only). A predicate on the consumer's mark through the dispatcher would
therefore need a new grant, which is an owner matter and is **not adopted** (see «Alternatives considered»); the
existence check needs none.

**The consumer's registration** follows the ADR-0037 pattern, in this order: the Redis upsert of the scheduler runs
**outside the database transaction and before the consumer's dedupe mark** (`markEventConsumed`, which
`apps/worker/src/outbox/deliver.ts` calls inside `withTenant`); a Redis failure is a retryable delivery outcome, so
**nothing is marked when the registration fails and the retry sees an unmarked event** and registers again (the upsert is
idempotent). **The mark is written only after a successful registration, so a mark can be trusted** to mean that the
registration succeeded at that moment. The pass's own rebuild is the same idempotent upsert and takes no mark at all.

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

**Three Redis keys.**

| Key | Meaning | Value |
| --- | --- | --- |
| **recovery key** `commissions:reminders:recovery` | "this pass owns the recovery": lease and marker in **one** key with a 120 s TTL | `{ incident_id, run_id, pass_id }`: the incident (null until known), the Redis `run_id` at the start (`R0`), a unique `pass_id` (UUID v7 from the injected `IdGenerator`, new for every pass) |
| **readiness sentinel** `commissions:reminders:sentinel` (FR-053) | "this generation was fully rebuilt and verified for the companies committed before `cutoff`" | `{ release, run_id, pass_id, cutoff }`: the `pass_id` of the pass that published it and its cut-off `C` (point 2); the release is diagnostic only |
| **pacing record** `commissions:reminders:recovery-slot` | "which retry slot (point 5) was last attempted for this incident", shared by every replica and by the operator | `{ incident_id, anchor, slot }`: the incident (null for an incident-free pass), **that incident's `raised_at` as the anchor of the schedule** (the PostgreSQL time of the first attempt for an incident-free pass) and the last slot attempted; **never deleted or replaced because of a candidate read from PostgreSQL before the lease: it is created or advanced by step 1 and rebound only by step 2, under ownership, to the verified incident**; deleted by the publish script, with a 24 h TTL as a safety net; **a pacing record, not a correctness input** |

**The one rule: ownership is checked immediately before every shared write, and a pass that fails the check stops and
does nothing else.** The shared writes are the incident-id update of the key, raising the flag, the clear, and the
publication; the rebuild's scheduler upserts are idempotent and need no check. The check is a compare-and-set on the
same `pass_id` in one Redis script (renew, update, delete, publish are all such scripts; nothing is an unconditional
write or delete); creation is `NX`. A key lost to TTL or a flush means ownership is lost. The lease only keeps replicas
from duplicating work; correctness rests on the `pass_id` compare.

**Detection and readiness (one rule: the incident wins).** Recovery is **needed** when the sentinel is missing or its
`run_id` differs from the server's, **or a flag of the code `COMMISSION_REMINDER_SCHEDULES_LOST` is open**, **or the
parked-event predicate P is true** (point 2), and at every worker process start. **Reminder recovery's detection, adoption
and clearing are restricted to that one code**: a flag of another code never starts this recovery, is never adopted, never
invalidates the reminder sentinel and is never sent through the clear function (which refuses it anyway, point 3).
**Readiness is not restricted: `/ready` is degraded while an incident of ANY code is open**, because the worker is not
healthy with it, even though the reminder path does not touch it and its own owner repairs it. **`/ready` is healthy only
when the sentinel is valid, no recovery key exists, no incident of any code is open and P is false**, read in one fixed
order so that observations on opposite sides of a clear or of a late insert are never combined (no new store). The probe
does three things: **(i)** an **atomic Redis snapshot** of the sentinel, the recovery key and the server's `run_id`;
**(ii)** one PostgreSQL read through the dispatcher facade of **the open incidents of every code** and of the
`CompanyCreated` events parked after the sentinel's `C` (`C` taken from (i); up to 101 candidates read, at most 100 ids returned with the overflow bit of point 2); **(iii)** a **final atomic
Redis check** of the same three, which also reads whether **the scheduler of each parked company listed by (ii) exists**.
«Atomic» means a Lua script or a `MULTI`/`EXEC` transaction, as Redis documents under
[transactions](https://redis.io/docs/latest/develop/using-commands/transactions/); a plain pipeline is not atomic. It
reports healthy only if **(i)** showed a valid sentinel (its `run_id` equals the server's) and no recovery key, **(ii)**
found no open incident of any code and no overflow of the parked-event read, and **(iii)** confirms **the same certificate** (the
same `pass_id` and `run_id` as in (i)), a `run_id` equal to the server's, no recovery key, and a scheduler for every parked
company listed. A new certificate between (i) and (iii) therefore makes this probe degraded (it was published by a real
recovery, and the next probe is healthy); an incident that raises, invalidates the sentinel and clears, then stops or
crashes before publishing, leaves the sentinel absent at (iii). **The probe's result applies to the moment of the
PostgreSQL read (ii), with the Redis certificate proven stable around it (the same certificate, the same `run_id` and no
recovery key at (i) and at (iii)); an incident opened after that moment is reflected by the next probe, and the result is
not a guarantee that extends to the final Redis check or to the moment the response is sent.**
A valid sentinel together with an open incident does not make the worker ready. The recovery and the close stay
**automatic** (CS-Q32): a new pass adopts the open incident, re-verifies every company's scheduler and closes it by the
normal path (clear, then publish); the operator command is only the fallback. A pass has an incident iff it finds a loss:
a missing or stale sentinel, an open flag **of the reminder code**, a changed `run_id`, or — in the start-up pass or a
pass started by P — **any company without its scheduler** (this is also CM-57b's first-deploy case). A pass that finds none
is a plain re-certification, with no ledger incident; it still rebuilds every company of its listing.

**One pass.**

1. **Own and pace, in one Redis script.** Given a **candidate** anchor and incident id read from PostgreSQL before the
   script (the open flag's `raised_at` and id, or null and the PostgreSQL time for an incident-free pass), and the
   PostgreSQL time, the script: **(a)** refuses when the recovery key exists (another pass owns it: wait and re-detect
   later, raise nothing); **(b)** if a pacing record exists, computes the latest **due slot `n`** of the schedule of point 5
   **from the record's stored anchor** and **refuses when `slot ≥ n`** (the slot was already attempted: the pass waits for the
   next one); if no record exists it computes `n` from the candidate and does not refuse; **(c)** otherwise creates the
   recovery key by `NX` and **creates the record `{ candidate incident, candidate anchor, slot = n }` if none exists, or
   only advances `slot` to `n` if one does**. **The candidate is read before the lease, so it is never written over an
   existing record: a stale candidate (a replica that read «no incident» and paused) cannot erase or replace the current
   incident's record.** A process start's first pass and the operator command skip the refusal of (b) (a new process or a
   person asked for it now) and still record the slot.
2. **Decide the incident, under ownership.** Re-read, under the key, the sentinel, the open flags **of the reminder code
   only** and the predicate P (point 2, `C` taken from the sentinel). **The reason that started the pass is carried into
   this decision and is never reduced to «nothing needed» unless it has vanished**, per this table:

   | Reason carried from detection | The «nothing needed» exit (delete the key and stop) |
   | --- | --- |
   | **A process start**, or **the retry of a failed start pass or of any failed incident-free pass** | **Never.** A valid sentinel does not cancel it: the pass lists and verifies every company of one complete listing and then publishes (a re-certification; a missing scheduler converts it to an incident). The retry keeps this reason until a publication |
   | Sentinel missing or `run_id` changed | only if the re-read finds a valid sentinel with the server's `run_id` (another pass published) |
   | An open flag of the reminder code | only if the re-read finds it cleared and the sentinel valid |
   | P true (including overflow) | only if the re-read finds P false and the sentinel valid |

   **P true with a valid sentinel and no flag → the pass continues as a plain re-certification: step 3 reads a new `C'` and
   rebuilds every company of one complete listing.** An open flag of the reminder code → adopt its id; a loss → `INSERT …
   ON CONFLICT DO NOTHING` raises the flag (one open flag per code), `/ready` turns degraded, the alert is raised. **When
   the insert returns no row (another insert won the conflict, for example a superseded pass's late insert), the pass reads
   the open flag of the reminder code in a fresh statement and adopts that id under the same ownership guard; if that flag
   has already been cleared, it re-runs detection from the start of this step.** Update the key's `incident_id`. **Then,
   in one script guarded by this `pass_id`, the pass binds the pacing record to the verified incident:** if the record
   already belongs to that incident nothing changes; otherwise (another incident, none, or a re-certification that found a
   missing scheduler and raised a new incident) the record becomes `{ that incident, that flag's raised_at, the due slot
   computed against that anchor }`: the slot of the old incident is never carried over, and the anchor and the slot always
   match the adopted incident. An incident-free pass does not touch a record bound to an incident. **When the pass adopts
   or raises an incident and a sentinel still exists, it invalidates the sentinel first — a guarded delete (only if the key
   holds this `pass_id`) — before the clear path.** An old valid sentinel therefore can never outlive the incident it
   predates: whatever the clear then does (true, false, unknown, or a superseded winner), `/ready` returns to healthy only
   after a new publication.
3. **Read `C`, then rebuild** every company of one complete listing (point 2). **Renew the key on a time basis while working, not after a whole page**: a
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
4. **Before the clear**, every company the listing returned has succeeded and the same ownership and `run_id` check holds.
   Then call the clear (incident passes only); no incident → skip.
   - **true** → step 5. **false** (already cleared elsewhere, or not this code's) → publish nothing, delete the key,
     stop. **unknown** (timeout, lost response) → **treated as not-mine**: publish nothing, delete the key, stop; the
     flag is not read to credit this pass (a closed flag plus an intact key cannot prove this pass committed).
   - A false or unknown answer never raises a flag by itself; the next detection decides.
5. **Publish**, guarded in one Redis script: write the sentinel `{ release, run_id: R0, pass_id, cutoff: C }` only if the key still holds
   this `pass_id` and incident and the server's `run_id` is still `R0`, and delete the key and the pacing record in the same
   script.

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
`raised_at` (no new column): rounds are time slots of one schedule counted from the anchor — **slot 0 at once, then 1, 3, 7
and 15 minutes after the anchor, then every 15 minutes**. **Which slot was last attempted is recorded in the shared
pacing record** (point 4, step 1), by the script that creates the recovery key. A pass starts a round only when a slot
newer than the recorded one is due, so **a new `pass_id`, a takeover, a second replica or a process restart continues the
same schedule and cannot run a slot that was already attempted**, even when ownership is lost repeatedly; which companies
still fail is recomputed by each pass (upserts are idempotent). **After a restart or a takeover the interval is derived
from the anchor, as the elapsed slots, downtime included:** the successor runs the latest due slot if it has not been
attempted, otherwise it waits for the next one. **A slot is a pace, not an attempt count:** under Reading A (no cap) the
schedule only decides when the next round runs and never exhausts the retries; a long downtime shortens the next wait, it
never ends the repair. If Redis itself was lost the pacing record is lost with it, and the first round runs at once, which
is right because everything was lost. A new incident starts a new schedule: step 2 rebinds the record to the incident that was verified under ownership, with
that flag's `raised_at` as the anchor and the slot computed against it (never a slot carried over from another incident
or from a stale candidate); an incident-free pass (a re-certification, including one started by P) is anchored on the
PostgreSQL time of its first attempt.

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

### 6. (e) Clear only when every company succeeded

The flag clears only in a pass in which **every** company the pass read succeeded (including one created mid-pass that a
later page of the listing returned) and the guards held. One failed company keeps the flag open, `/ready` degraded, the alert
repeating (Waleed's note, owner-questions §32). The certificate covers the companies committed before `C` (point 2);
companies after `C` are the consumer's, and their failure to register shows as the parked-event check of point 4, never
as a silent gap. **CM-57c:** a quiet business is part of the pass like any other: its scheduler is rebuilt from the id, and on
its next run the reminder job creates the `DRAFT` row through `lockStatementPeriods`, writes the ledger entry
`commission_statement_reminders` and sends the reminder; a company whose `commissions` feature is off still gets its
scheduler (the job ends without writing, FR-053).

### 7. Fallback: the operator command

The audited fallback when automatic recovery does not complete: a Redis-side failure, a missing dispatcher grant or a company that cannot be rebuilt (issue #1222 item 8). **It depends on the same definer function and policy as the worker** — the owner role can EXECUTE `recovery_company_ids` without a grant to `pospay_dispatcher`, but the function still runs as `pospay_recovery_company_reader` under `companies_recovery_select`, so a missing or broken definer or a missing or wrong policy cannot be worked around, and **the command never runs a direct `SELECT` that would bypass the live-company filter**. Before it lists, it therefore checks that the function exists and is owned by `pospay_recovery_company_reader`, that the policy `companies_recovery_select` exists on `companies`, and that a probe call returns a page; **if any check fails it stops with a fixed error code (`COMMISSION_REMINDER_RECOVERY_FUNCTION_MISSING`, `…_POLICY_MISSING` or `…_PROBE_FAILED`) before touching any scheduler, key or flag.** `docs/runbook.md` gives the verification and repair steps (the privilege-inventory check, re-applying the migration) before a retry. **It runs the same pass routine
as the worker (point 4, steps 1–5), with four differences only:** **(1)** it runs as the owner role but **lists companies by calling the same definer function
`recovery_company_ids`** (same keyset order, same page size), **not by a query of its own**: the live-company predicate is
written once, in the RLS policy `companies_recovery_select` (point 1), which applies to the function's owner role whoever
calls it, so the operator's list and the worker's list cannot drift and a deleted company is skipped by both (the owner
role bypasses RLS on a direct `SELECT`, which is why it does not run one); **(2)** it clears with its own identity
(audited) instead of `system:worker`; **(3)** it skips the pacing refusal of step 1 (a person asked for it now) while still
recording the slot; and **(4)** **it clears only the incident it named**: under the lease, step 2 requires the named id to
still be the open incident of the reminder code; if it is not (already cleared, or another incident is open) the command
**stops, releasing its key by compare-and-set, without adopting, raising, clearing or publishing anything** and tells the
operator. **So the cut-off protocol is the worker's, not a variant: the command reads `C` from PostgreSQL
(`SELECT statement_timestamp()`) before its one complete listing, verifies each company's scheduler and upserts the
missing ones with the same idempotent upsert, and publishes that `C`, only after every company the listing returned
succeeded.** It never samples `C` after the scan or at publication. A company that commits after `C`, behind the
command's cursor, belongs to the consumer; if its delivery fails until the outbox parks it, P is true (the parked event is
after `C` and its scheduler is missing), so readiness degrades and a new pass follows. It **does not depend on outbox
consumer marks**: it **first creates the same recovery key** (its own `pass_id`, the incident it names, the current
`run_id`); it renews the key under the same ownership guard, on the same time basis (at most every third of the TTL, each
renewal re-checking that the server's `run_id` is still `R0`), with the same per-operation deadlines and the same maximum
interval without progress as the worker (point 4, step 3), so a scan longer than the TTL does not lose the key and a
stalled read or upsert ends the scan, frees the key by compare-and-set and clears nothing; it aborts at once on a failed
renewal, a lost key, a changed `run_id` or a failed upsert (clearing and publishing nothing). **Like the worker (step 2 of
point 4), once it adopts or names the incident it invalidates an existing sentinel with the same guarded delete, before it
clears**: an abort or a crash after the clear then leaves the sentinel absent and `/ready` degraded, never healthy on the
old certificate. A worker pass that owns the key makes the operator wait or stop that worker first. Replaying
`CompanyCreated` is no longer part of this primary path: it stays a documented secondary tool (a consumer's mark in
`consumed_events` makes a replay skip a company, so it can never be relied on to rebuild).

### Refinements made in the 56b-1 code PR (issue #1222; no accepted decision changes)

The code PR closes the items of [issue #1222](https://github.com/lolotam/PayPos.systems/issues/1222) by proof or fix, never by a
weaker readiness. The contract of points 1 to 7 above is unchanged; these refinements only make it precise.

- **The outbox sequence fence (item 2).** The sentinel also carries `cutoff_seq`, the highest `outbox.seq` at the moment `C`
  was read (same statement). The parked-event predicate P selects a parked `CompanyCreated` row when `parked_at > C` **or**
  `seq > cutoff_seq`, so a row parked with `parked_at <= C` after a backward clock correction is still detected, and a
  database clock that reads earlier than `C` invalidates the certificate and starts a pass.
- **Consumer specificity of P (point 2, item 3 of §2).** A parked `CompanyCreated` counts toward P, the parked alert and
  `/ready` only when **the commission scheduler of that company is actually missing from Redis**; one parked for another
  consumer (for example `staff`) whose scheduler exists never starts a pass or degrades readiness.
- **Bracketed `/ready` (item 3).** The probe reads PostgreSQL before and after the Redis check of the parked companies'
  schedulers and degrades on any change of the open flags or of the parked set between the two reads, in addition to the
  certificate comparison of point 4; it never reports healthy for a state that was never healthy.
- **Pacing (items 4 to 7).** Pacing is applied **after** the under-lease read: a pacing record of another (closed)
  incident never delays a new loss, an operator command records the slot only after verifying that the incident it named
  is the open one, a process start's first pass of a Redis generation skips the refusal once (the record keeps
  `startup_run_id`) and every later start in the same generation follows the shared schedule, and the «nothing needed» exit is
  taken only when the fresh read shows a valid sentinel, no open reminder incident and P false, with no start-up reason.
- **Incident adoption (point 4 step 2).** A pass adopts the open incident, or raises one the moment it finds a loss
  (a sentinel missing or from another `run_id` outside a start-up pass, or any company without its scheduler during the
  rebuild), invalidates the sentinel before the clear path, and rebinds the pacing record to that incident. By design, a
  `STARTUP` pass with a missing or stale sentinel raises `COMMISSION_REMINDER_SCHEDULES_LOST` only if at least one live
  company lacks its scheduler, so a first deploy with zero companies or a process start where every scheduler is intact
  re-certifies without opening a spurious incident.
- **Snapshot ordering fence (issue #1222 item 2).** `cutoff_seq` carries `<max_outbox_seq>@<pg_current_snapshot>` captured
  in the same statement as `C`, so an in-flight `CompanyCreated` transaction open when `C` was sampled that commits and parks
  later with a regressed clock (`parked_at <= C` and `seq <= max_outbox_seq`) is still detected via
  `NOT pg_visible_in_snapshot(o.xmin::text::xid8, snap)`. Casting 32-bit `xmin` to `xid8` assumes transaction-ID epoch 0
  (`< 2^32` transactions) and falls back safely to `seq > cutoff_seq` / `parked_at > cutoff` beyond epoch 0.
- **Pacing and healthy detection (point 4 step 1).** Periodic `DETECT` ticks evaluate `snapshot`, open flags, parked events,
  and parked schedulers read-only before acquiring `commissions:reminders:recovery`, so a healthy system never raises false
  `RECOVERY_IN_PROGRESS` on `/ready`. All recovery PostgreSQL calls run under operation deadlines while holding the lease, and
  rebuild passes upsert every company scheduler in the listing (idempotent refresh).
- **Stalled work (point 4 step 3).** Page reads, scheduler checks and upserts have their deadlines (30 s, 30 s, 10 s) and the
  pass a maximum interval without progress (90 s) and a hard pass deadline; on any of them the pass stops renewing,
  deletes its own key by compare-and-set and ends as a failed round without a clear or a publication.
- **The consumer mark (point 2 of §2, CM-57b).** The consumer `commissions.reminder-schedule` is registered for
  `CompanyCreated`; the scheduler is registered in Redis in the delivery path before its `consumed_events` mark and outside
  the database transaction, so a Redis failure is a retryable failure with no mark.

### 8. Periodic scheduler-coverage verification (issue #1220)

A single scheduler can vanish while the Redis process and the certificate survive (§4 sees no loss). Besides the
delivery-path repair (CM-57b) and the process-start pass, the worker runs a **bounded coverage sweep**:

- **Cadence and cost.** Every 5 minutes (`REMINDER_COVERAGE_SWEEP_INTERVAL_MS`) one sweep, with its own timer and a guard
  so two sweeps never overlap. A sweep reads at most 5 pages of 200 company ids through the same narrow
  `recovery_company_ids` read (no new function, grant or role), checks each page with one Redis pipeline of `EXISTS`, and
  registers at most 100 missing schedulers (a refused registration does not use that cap, and the cursor moves past it); it stops starting pages or registrations after 60 s, re-checks the lease before every page, and bounds every operation at 10 s. The
  cursor lives in memory and wraps, so a sweep covers up to 1,000 companies and a full cycle over N companies takes
  `ceil(N / 1000)` sweeps (5 minutes each; 10,000 companies: about 50 minutes) while no sweep costs more than 5 reads,
  5 pipelines and 100 upserts.
- **Only the absent ones.** It registers only the schedulers that do not exist (the idempotent upsert of §2), never the
  whole page (unlike the recovery pass, which refreshes cadence).
- **No recovery state.** It takes no lease, invalidates no certificate and raises no incident: `/ready` is unaffected. It
  runs only while the certificate is valid (same `run_id`, no lease). With a missing or stale certificate, or while a pass
  owns the lease, it does nothing and the recovery pass owns the case.
- **Alert.** When it finds missing schedulers it logs one warning with `code`
  `COMMISSION_REMINDER_SCHEDULER_RESTORED` and the counts `missing`, `restored`, `failed` (no company id). A failed
  registration is retried by the next cycle.
- **Known false positive.** A company whose `CompanyCreated` has not yet been delivered has no scheduler, so a sweep can
  register it early (harmless, idempotent) and log the alert for it; the alert is therefore a signal to look at, not proof
  of a loss.

## What the code PR must amend

`CLAUDE.md` §5 (the dispatcher also reads company ids through one definer, clears one named flag through another and
inserts flags by column; both recorded as exceptions beside the outbox dispatcher and the migration data step); ADR-0003
§3 (the `pospay_dispatcher` row, the two owner roles, a section «global operational flags»); ADR-0054 §2 (_Access_ and
_Clearing_ point here; `INSERT (id, code, raised_at)`); `docs/runbook.md` (automatic recovery first, the operator command
as fallback, the three keys, the rollout rule); `packages/db/src/roles.ts`, `dispatcher.ts` (`raiseRecoveryFlag`,
`openRecoveryFlags`, `companyIdPage`, `clearRecoveryFlag`); the privilege inventory (`function-inventory.ts`,
`table-grants.ts`, `privileges.spec.ts`: attributes, ownership of exactly one function each, no schema `CREATE`,
effective privileges); the module map (the worker `commissions` recovery reader and the `CompanyCreated` consumer row); the dispatcher facade's
read of `outbox` (`parked_at`, `event_type`, `company_id`) for the parked-event list (the role already reads and marks
`outbox`; the code PR confirms the column grants and adds nothing else; **no grant on `consumed_events` and no other
grant is needed**); the sentinel's `cutoff` field, the pacing record and the alert
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
  healthy on the next; an open flag with a valid sentinel and no key → degraded; **an open incident of any other code
  with a valid sentinel and no key → degraded** (without starting a reminder pass); **a parked `CompanyCreated` whose
  company has its scheduler (the `staff` consumer failed) → healthy; a parked one whose scheduler is missing → degraded; exactly 100
  parked rows whose schedulers exist → healthy, 101 (overflow) → degraded, tested separately (fails closed).**
- **Renewal:** **a page slower than the TTL does not lose the key** (renewals every ≤ TTL/3 while working, each
  re-checking `run_id` = `R0`); **a failed renewal mid-page stops the pass at once** with no further upsert or shared
  write.
- **Retry and pacing (Reading A):** across successive `pass_id`s, takeovers and restarts the schedule continues from the
  anchor and never ends while the incident is open; **a successor that takes the key after a pass lost it mid-slot waits
  for the next slot and does not run the slot again, also when ownership is lost several times in a row; two replicas
  contending for the same due slot run it once; a Redis flush loses the record and the first round runs at once; the
  operator command and a process start's first pass skip the wait and record the slot; a replica that read «no incident»,
  paused while another replica raised an incident and attempted a later slot, and resumed after that lease ended neither
  erases nor replaces the incident's record and cannot rerun its slot; a re-certification that reaches a later slot and then
  finds a missing scheduler and raises a new incident ends with the record rebound to the new incident's `raised_at` and
  the slot computed against it.**
- **Start-up:** **a process start with a valid sentinel, no reminder flag and P false still lists and verifies every
  company and then publishes; a start pass that failed and is retried does the same (it never takes the «nothing needed»
  exit); a missing scheduler that disappeared while the sentinel survived is found and repaired by it;** a process start
  (also after a rollback to the same release) runs a pass; `/ready` is degraded until it
  publishes; a missing scheduler found while ownership and `R0` hold turns it into an incident recovery under the same
  key; **a changed `run_id` during the scan, with the key still present or lost, stops that pass without clearing or
  publishing and a new pass (fresh `R0`, new `pass_id`) recovers the incident**; a failing incident-free pass retries and
  raises `COMMISSION_REMINDER_RECERTIFICATION_FAILED` with no ledger incident.
- **Operator fallback (the same pass routine, point 7):** creates the key before it touches any scheduler; **an old valid
  sentinel is invalidated before the clear, and an abort or a crash after the clear leaves `/ready` degraded**; with an
  already-consumed `CompanyCreated` event and a missing scheduler it still restores the scheduler; **ownership lost during
  the operator's scan (a failed renewal, a lost key) aborts it without a clear or a publication; a scan longer than the TTL
  does not lose the key**; aborts on a changed `run_id` without clearing or publishing; on success the next heartbeat is healthy and no incident reopens; **the named incident was already closed before the
  command acquired the lease, or another incident is open: the command stops without adopting, raising, clearing or
  publishing, and clears no other incident under the operator's identity; a deleted company is skipped by the operator's
  listing exactly as by the worker's (both call `recovery_company_ids`);** **the operator reads `C` before its listing and publishes that `C`, never one taken
  after the scan or at publication: a company that commits after `C`, behind the operator's cursor, whose delivery fails
  until it parks before the operator publishes is not lost: P is true, `/ready` is degraded and a new pass schedules it.**
- **Coverage and the cut-off `C` (one protocol):** a company committed before `C` is returned by the one complete listing
  **even when its id is below the cursor** (a company committed before the `C` statement's snapshot, with an id below the
  cursor, is read); **a company that commits after `C`, behind the cursor, whose `CompanyCreated` delivery fails until it
  parks: `/ready` is degraded, `COMMISSION_REMINDER_COMPANY_SCHEDULING_PARKED` is raised and a new pass (new `C'`)
  schedules it; the same company with a delivery still being retried does not degrade readiness**; the pass publishes only
  after every company the listing returned succeeded; **under steady onboarding (companies committed during the listing)
  the listing still finishes and certifies**; a quiet company is part of the pass (CM-57c); `parked_at > C` holds for a
  company the `C` snapshot did not see.
- **The reason that started the pass (step 2):** **a valid sentinel, no reminder flag and P true does not take the «nothing
  needed» exit: the pass rebuilds every company with a new `C'`, finds the missing scheduler, converts to an incident (or
  repairs it) and ends with a sentinel carrying `C'`**; the «nothing needed» exit is taken only for a reason that has vanished, per the table of step 2.
- **Consumer specificity:** a parked event whose commission scheduler exists (the `staff` consumer failed) neither
  degrades readiness, nor raises the alert, nor starts a pass; a parked event whose scheduler is missing does all three.
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
- **A parked-event predicate on the commissions consumer's mark in `consumed_events`, read by the dispatcher:** the
  dispatcher cannot read that table (migration 0006 grants it to `pospay_app` only, per company), so this needs a new
  grant, an owner matter; not adopted. Reading the mark as `pospay_app` under `withTenant` per parked company needs none
  but proves less than the scheduler's existence (a registration that once succeeded can be lost with Redis).
- **Reading company ids from `outbox` events; operator-only recovery:** only the dispatcher reads `outbox`, old events
  may be gone; operator-only is superseded by CS-Q32.

## Known limits and follow-ups

- **The residual window of point 4** (question vi): **accepted by Waleed on 2026-11-22 exactly as described in point 4**
  (the incident can close on a Redis check that is already stale; readiness is never published for the lost generation and
  a new incident is raised at the first heartbeat after the connection returns). It is not widened by anything else in this
  ADR: the cut-off, the parked-event check, the pacing record and the retry add no closing path.
- **A single lost scheduler with a surviving Redis process and sentinel** is not a recovery event; it is covered by the
  periodic verification of §8 ([issue #1220](https://github.com/lolotam/PayPos.systems/issues/1220)), with the repair
  delay bounded by the sweep cycle (5 minutes per sweep, one full cycle per `companies / 1000` sweeps).
- **Four open items, each required to be proven or closed in the 56b-1 code PR before that PR merges**
  ([issue #1222](https://github.com/lolotam/PayPos.systems/issues/1222)); not all of them fail safe, and the ADR does not claim so:
  (1) **no fixed upper bound for the recovery listing** under sustained onboarding with slow Redis: the pass may not reach
  the clear, and the operator must stop the worker to take over; `/ready` stays degraded, so readiness fails closed, but
  completion is not guaranteed; the code PR bounds the listing at a company id captured with `C`, in both paths; (2) **a
  PostgreSQL wall clock moving backward can hide a park**: a company that commits behind the cursor can park with
  `parked_at <= C`, and the predicate P then ignores it, **so a company can stay unscheduled until another trigger runs**
  (this does not fail safe); the code PR uses an ordering fence that does not depend on clock monotonicity, or detects the
  discontinuity; (3) **the readiness probe combines Redis and PostgreSQL states read at two instants**: one probe can report
  `/ready` healthy although **no healthy instant existed** (a flag opens and a scheduler is restored between steps (ii) and
  (iii) with the certificate unchanged), and the next probe is correct; the code PR brackets the scheduler check with
  PostgreSQL reads or documents the weaker contract; (4) **serial replica restarts can re-run one slot** (a process start
  skips the pacing refusal): extra idempotent full scans, never a false healthy state; the code PR applies the pacing to
  start-up passes or defines one start-up exception per recovery generation. Each carries the test named in the issue.
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

## Addendum (2026-11-27): package-recovery discovery (#1035)

`apps/worker/src/package-recovery-discovery.ts` (spec 058 rows 42 and 47-2, issue `#1035`) reuses `dispatcher.companyIdPage` (`public.recovery_company_ids`) to list live company IDs at startup and every 2 minutes when Redis loses repeatable recovery schedules (`package-sale` and `package-import-commit`). No new grant, role, pool, column or table read is added: `recovery_company_ids` still returns live company IDs only (`pospay_recovery_company_reader` under `companies_recovery_select`), and each per-company pending check runs inside a short `withTenant(companyId)` transaction on `pospay_app` with existing indexes. Technical operational extension; not published on the owner decisions site.
