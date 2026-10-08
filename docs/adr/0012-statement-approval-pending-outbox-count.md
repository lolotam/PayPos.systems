# ADR-0012 — Statement approval pending-outbox count

- **Status:** Accepted
- **Date:** 2026-10-02
- **Slice:** Phase 1 · G2 · before PR 53 (`approve-statement`)

## Context

[SPEC §6](../specs/phase-1/SPEC.md#6-consistency--events-estimate-review-approval-corrections) requires approval to
return retryable 409 while this company's commission-relevant events created before approval began are unprocessed.
The check belongs inside the transaction that locks the statement and freezes its inputs. The gate is company-wide,
even when the statement belongs to one business or period; it does not inspect event payloads to narrow that scope.

Today `pospay_app` may INSERT into `outbox` but cannot SELECT it. ADR-0003 gives the dispatcher cross-company
SELECT and delivery-metadata UPDATE only. `consumed_events` records each consumer's effect in the same transaction
as that effect. `published_at` records transport completion, which is a different fact from commission processing.
This ADR designs one scalar read capability; it creates no function, role, migration or application code.

## Decision

### 1. Fixed function contract and definition of pending

The proposed function is `public.statement_pending_commission_events(approval_started_at timestamptz) RETURNS bigint`.
Its only input is the database transaction's start timestamp, captured by the approval persistence adapter **before
waiting for the statement lock**, using `pg_catalog.transaction_timestamp()`. The function rejects NULL or a value
different from its own transaction start. A client timestamp or an old retry's timestamp is never accepted.
Pass the exact server value (or its lossless PostgreSQL text representation), not a JavaScript Date that drops
sub-millisecond precision; otherwise a legitimate cutoff could fail the equality check.

The tenant comes exclusively from `public.app_company_id()` on the existing `withTenant` transaction. Missing or
malformed context fails closed with an error, never a zero count. There is no company, business, period, event-list,
consumer-id, limit or SQL-fragment parameter. The caller cannot choose a different tenant or omit an event type.

Count each visible `public.outbox` row once when all these predicates hold:

- `company_id` equals the transaction's company and `created_at < approval_started_at` (strictly before).
- `event_type` is one of `ServiceLineChanged`, `PackageSaleChanged`, `SessionTipsChanged`, `SalaryChanged`.
- No committed row in `public.consumed_events` matches that company, event id and the commission projection consumer.

Use one durable consumer id, **`commissions.project-inputs`**, for the four input event types. PR 50 must register
that id and commit its dedupe mark together with projection updates, corrections and generation changes under
the appropriate statement locks. PR 53 must assert that the registered id/types and this function agree; changing
the id needs an explicit dedupe transition, never simply renaming it. Other consumers' marks do not discharge it.

Parked events, leased events, events waiting for retry and even published events without the commission mark remain
pending. A committed commission mark discharges the event even if another consumer failed or publication marking
was lost. Stale-revision no-ops still need their commission mark. Do not use `published_at IS NULL` as the predicate,
do not read `payload`, and do not delete an outbox row before every required consumer has committed its mark.

### 2. Owner, grants and RLS — exact new privileges

Create a dedicated function-owner role **`pospay_approval_reader`**: NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOINHERIT,
NOCREATEDB, NOCREATEROLE, NOREPLICATION; member of no role. No runtime role may inherit or SET ROLE to it.
It owns only this function, no table, schema or other function. The migration owner transfers function ownership
without leaving any schema CREATE privilege on this role.

| Grantee | Exact additional privilege |
|---|---|
| `pospay_approval_reader` | `USAGE ON SCHEMA public` |
| `pospay_approval_reader` | `EXECUTE ON FUNCTION public.app_company_id()` (effective helper access is asserted) |
| `pospay_approval_reader` | `SELECT (company_id, id, event_type, created_at) ON public.outbox` |
| `pospay_approval_reader` | `SELECT (company_id, consumer_id, event_id) ON public.consumed_events` |
| `pospay_app` | `EXECUTE ON FUNCTION public.statement_pending_commission_events(timestamptz)` only |

Keep ENABLE and FORCE RLS on both tables. Add a SELECT policy **TO `pospay_approval_reader`** on each, with
`USING (company_id = public.app_company_id())`; retain the explicit company predicates inside the function too.
Neither policy uses `true`. Existing app/dispatcher policies and grants remain unchanged. No new connection,
dispatcher credentials, table SELECT for `pospay_app`, runtime role membership, sequence grant or write grant.

Declare SECURITY DEFINER, STABLE, not LEAKPROOF, with **`search_path = pg_catalog, pg_temp`** and **`row_security = on`**.
Fully qualify the two relations and the context helper; use fixed SQL with no dynamic execution. The function
returns only a non-negative scalar count, never ids, payloads, event names or another company's existence.
PostgreSQL's [definer guidance](https://www.postgresql.org/docs/16/sql-createfunction.html) requires a safe path
and explicit execution ACLs; neither the migration owner nor a table owner is the ongoing function owner.

Create the function, transfer ownership, revoke **ALL ON FUNCTION** from PUBLIC, `pospay_auth`,
`pospay_dispatcher`, `pospay_notifications` and `pospay_suppression_reader`, and grant app EXECUTE in the same
migration transaction. The owner's implicit rights are expected; no other runtime grantee is allowed.
Audit effective inherited/PUBLIC privileges, not just explicit ACL rows. No schema CREATE privilege is granted
to the app or reader; the existing idempotency sweep and suppression definer keep their own ACLs.

### 3. Approval transaction and concurrent changes

PR 53 uses the existing `withTenant` connection as `pospay_app`, at READ COMMITTED. Capture the database start time,
lock the statement, recheck the ended period, owner permission, REVIEWED status, current/reviewed fingerprints,
missing performers/configuration and blocked corrections, then call the count through a persistence adapter.
Count > 0 **refuses approval with retryable HTTP 409**, using the English message
**"updates are still being calculated, try again shortly"** and its ar/en i18n translation. Roll back without
frozen lines, status change or approval audit; the user retries manually in a fresh transaction. Do not poll,
auto-approve, bypass the count or approve an incomplete statement after a timeout. If a relevant event is parked,
raise an owner-visible operational alert through the existing outbox/notification boundary, independent of the
rolled-back approval transaction; parking never discharges the event. Alerting must not require app SELECT on
outbox or reading event payloads in this function.
Count = 0 permits freezing the lines/fingerprint and recording approval/audit atomically, still holding the lock.

A consumer that committed before the lock is reflected in the fingerprint; one waiting behind approval observes
APPROVED and posts a correction. An event created at/after the cutoff, or committed only after the count's snapshot,
can reach commissions after approval and must take that correction path. The count is not a global commit barrier:
`created_at` defaults to the producer transaction's start, and an in-flight producer can be invisible at the check.
Do not claim that this check alone eliminates all concurrency; SPEC §6's statement locks and corrections do that.

### 4. Tests PR 53 must add

Run against real PostgreSQL as the restricted roles (ADR-0006), with two synthetic companies:

1. Catalogue/effective-privilege assertions: exact function signature, owner, SECURITY DEFINER/STABLE, pinned path,
   row_security, column ACLs and role attributes; PUBLIC/auth/dispatcher/notifications cannot execute it;
   app/other runtime roles cannot SET ROLE to the reader. Reader cannot read payloads, mutate either table,
   access tenant business tables or create objects. App still cannot SELECT outbox metadata or payloads directly.
2. Context isolation: no context and malformed context error; A's function call never counts B, including identical
   event ids in different tenants. Pooled A → B → no-context calls, rollback, exceptions and concurrent tenant
   transactions preserve transaction-local context. NULL/old/future supplied cutoffs fail.
3. Predicate fixtures: every one of the four types, unrelated events, created before/equal/after cutoff,
   missing/correct/wrong-consumer/wrong-company marks, stale revisions, published-but-unconsumed and
   consumed-but-unpublished rows; leased/backoff/parked rows still count. Result is lossless bigint, no row data.
4. Search-path attacks: synthetic temporary objects shadow `outbox`, `consumed_events` and `app_company_id`;
   changing the caller's path cannot redirect the read, bypass RLS or cause writes.
5. Atomicity: a consumer rollback leaves its event pending; a committed effect/mark discharges it. Pending events
   return retryable 409 with the specified ar/en message and no approval side effects. Manual retry after processing
   uses a fresh cutoff and can approve; parked events still refuse approval and produce the owner alert independently
   of approval rollback. No timeout or automatic retry approves incomplete inputs. A failure while freezing rolls
   back lines, fingerprint, status/audit.
6. Concurrency with barriers rather than sleeps: consumer before/after approval, two approvers, producer begun
   before cutoff but committing after the check, session/redemption/refund/salary/tip events, and plan/override
   writers. Each input lands in the frozen result or a correction; plan/override writers recheck closed status.
7. Result-shape and EXPLAIN assertion on the count, including a large synthetic tenant. PR 53 adds an index on
   `(company_id, event_type, created_at, id)`; the existing consumed-events PK covers its anti-join. Generate a new
   migration and update the privilege/definer inventory allowlists; do not rewrite existing migrations or tests
   to permit arbitrary future definers.

### 5. Owner decisions — 2026-10-02

- **Waleed:** pending commission outbox events refuse approval with a retryable 409:
  "updates are still being calculated, try again shortly". Retry is manual; alert the owner if an event is parked.
  Never approve an incomplete statement. §3 applies this decision without weakening the company-wide check.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| App SELECT on outbox, even with tenant RLS | exposes payloads and broadens the existing append-only boundary |
| Dispatcher pool or table-owner/BYPASSRLS definer | needlessly introduces cross-company privilege into approval |
| Only unpublished events, or any consumer's mark | confuses transport completion with the commission effect |
| Caller-selected company, period, event list or consumer | lets a caller narrow the completeness check or probe other tenants |
| Poll/drain the worker inside approval | holds the statement lock the consumer needs and makes the request unbounded |

## Consequences

- Approval acquires a small, tenant-scoped count capability; dispatcher privileges and business-module arrows do
  not expand. The reader role is part of the definer/ACL inventory, not a new runtime login or raw DB facade.
- A relevant backlog anywhere in the company can block a business's approval. Parked commission events require
  operational repair; they are never ignored to make the count zero.
- PR 53 must deliver the function, policies/grants, index, adapter and listed tests together. G2 accepts that
  design contract; this document does not claim implementation or runtime correctness.

## Open questions for the owner

None for G2: the backlog UX is settled by the owner decision above. The company-wide scope and strict cutoff
remain fixed by SPEC §6; PR 53 must implement and verify the accepted contract.

## Amendment — 2026-10-08: SalaryChanged recognition and PR 50 backfill

**Owner decision (Waleed):** recognize `SalaryChanged` in the worker now without a consumer.
The dispatcher may mark it published so that a salary change does not retry, park and block
later events on the same `employee` aggregate, including attendance, documents and alerts.

**PR 50 obligation:** when `commissions.project-inputs` ships, it must backfill `SalaryChanged`
outbox rows published before that consumer existed, across all affected tenants. Select rows
missing that consumer's committed mark, including rows with non-null `published_at`, and apply
the normal tenant-scoped, idempotent projection/correction path with the statement locks and
atomic effect/mark required by §1. Normal dispatch of unpublished rows alone is insufficient.
PR 50 must test a previously published salary event, repeat backfill without duplicate effects,
and prove that a failed projection leaves its consumer mark absent.

ADR-0012's approval contract remains fail closed: publication is not commission processing.
Until the `commissions.project-inputs` mark commits, a salary event before the approval cutoff
remains pending and refuses approval. Retain those outbox rows for the backfill; do not add a
placeholder consumer mark or weaken the pending count to treat publication as completion.
