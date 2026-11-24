# Plan 53-2 B2b: the parked commission event alert (durable)

Scope: ADR-0012 section 3 ("raise an owner-visible operational alert" when a counted commission event is parked) and
its section 4 group 5. Tier: Heavy (outbox). Implementer: Claude Sonnet 5.5 only, plus one independent review and the
bot panel (PP-266). No migration, no new database grant, no new role privilege.

This plan replaces the delivery design of the saved draft. It was written on 2026-11-24 from a read of the code; nothing
was run. Section 8 lists what was verified and what was not.

## 1. Where the work stands

- Draft branch `wip/059-53-2b2b-parked-alert` at `1d83192e5`, based on `be573e648`, 14 commits behind main
  `973b56182`. `git merge-tree` reports no textual conflict with main.
- 37 files, +1442/-30. About 890 hand-written production lines by MiniMax M3.1 Flash, one test edit by Big Pickle, one
  integration file of 8 cases by HY4 Flash. No migration.
- Never run: the integration file `apps/worker/src/modules/commissions/__tests__/parked-commission-alert-db.spec.ts`.
  The unit tests were reported green by the implementer and were not re-run by the reviewer.
- No pull request exists. The branch is a backup, not a base that has been reviewed.

**The draft is untrusted input.** The implementer re-reads every file it keeps and treats it as a proposal, not as
finished code.

## 2. The defect this plan removes

The draft raises the alert from a hook inside the dispatcher (`notifyParked` in `packages/db/src/dispatcher.ts`). The
hook starts the alert and does not wait for it; `apps/worker/src/main.ts` only logs a rejection, and the dispatch loop's
`stop()` does not drain it. A park happens once per event and nothing re-triggers the hook. So if the worker stops, or
the application database is briefly unavailable, between the committed park and the alert transaction, the owner is
never told, and the approval stays blocked by `COMMISSION_UPDATES_PENDING` with no visible reason.

## 3. Decision: a sweep is the only trigger; the dispatcher hook is removed

The alert is raised by a periodic sweep in the worker, and by nothing else.

1. **Read (dispatcher role, read-only).** A new facade method on `createOutboxDispatcherDatabase` returns one page of
   parked counted events: `id`, `company_id`, `event_type` only, for rows with `parked_at IS NOT NULL`,
   `published_at IS NULL` and `event_type` in the six counted types, ordered by `seq`, after a cursor, with a bounded
   limit. It asserts the role like the replay pages do. It reads no payload and writes nothing.
2. **Alert (application role, per event).** For each row the sweep calls the existing use case
   `RaiseParkedCommissionAlert` under `withTenant(company_id)`. The mark `consumed_events` with consumer id
   `commissions.park-alert` and the bell are written in that one transaction, so they commit or roll back together.

Why two steps and not one anti-join: `pospay_dispatcher` holds `SELECT` on `outbox` only and has no privilege on
`consumed_events` (migration 0006). One query would need a new grant, a migration and a new exception in `CLAUDE.md`
section 5. The use case is already idempotent, so the second step can be repeated safely.

Why the hook goes: with the sweep as the guarantee the hook is only a latency shortcut, and it is the part that
changes `dispatchBatch` and `recordQuery` in the most sensitive file of the repository. Removing it returns
`dispatchBatch` and `recordQuery` to their text on main. A bell that arrives within one sweep interval is acceptable for
an event that blocks a monthly approval. No latency requirement exists that would justify keeping it.

**Guarantee the reviewer checks:** after a park is committed, the owner's bell is written exactly once, whatever
happens to the worker process in between, as long as the worker runs again.

## 4. Rules the implementer must hold

- **Interval.** Default 60 seconds, a named constant, injectable for tests like `sweepIntervalMs`. It runs inside the
  existing dispatch loop tick, between batches, like the idempotency sweep, so `stop()` already waits for it.
- **Bound per sweep.** Parked rows are never cleared (no operator path re-queues a parked event), so the candidate set
  only grows. The sweep keeps, in process memory only, the set of event ids it has already settled (`ALERTED` or
  `ALREADY_ALERTED`) and skips them without a transaction. After a restart the set is empty, so the first sweeps
  re-check every parked counted event once; each check is one small tenant transaction that ends in
  `ALREADY_ALERTED`. One sweep walks at most a fixed number of pages (suggested 10 pages of 100) and continues from its
  cursor on the next sweep, wrapping to the start after the last page. The memory set is an optimisation; the mark is
  the only source of truth.
- **`NO_OWNERS`.** No mark is written, so the event is retried on later sweeps and alerts as soon as an owner
  membership exists. The error log line is written once per event id per process, not on every sweep.
- **A failing alert.** An exception from one event's alert is logged with the event id and type and does not stop the
  sweep, the page or the dispatch loop. That event is retried on the next sweep.
- **Two worker replicas.** Both may sweep the same event. `markEventConsumed` is a single
  `INSERT ... ON CONFLICT DO NOTHING RETURNING`, so the second transaction waits for the first and then reports
  `ALREADY_ALERTED`. No advisory lock is added.
- **Six counted types only**, taken from `COMMISSION_INPUT_EVENT_TYPES` in `packages/domain`, never a second list.
- **Query plan.** The page query must use the partial index `outbox_unpublished_idx` (`seq` where
  `published_at IS NULL`) and must not scan `outbox` sequentially. An `EXPLAIN` assertion ships with it. If the
  assertion cannot be met without a new index: stop and report, because that turns the slice into a migration.

## 5. What must not change

- `dispatchBatch`, `recordQuery`, `exhaustQuery`, `claimQuery` and the fence in `packages/db/src/dispatcher.ts`:
  byte-identical to main after this slice, apart from the new read method being added to the returned facade.
- The pending predicate, the consumer id `commissions.project-inputs`, the function
  `statement_pending_commission_events` and every grant and policy of ADR-0012 sections 1 and 2.
- The coverage objects of migration 0250.
- No un-park, no re-delivery, no delete of a parked row.
- No existing test is edited to fit the new code without the reviewer's approval.
- The decisions already taken in the draft and kept: company owners as recipients (active memberships at the alert
  instant), in-app bell only, groups of at most 100 recipients, one bell per parked event id, the bell carries the
  event's type and id only (no payload, amount or name), the alert is not an alert-rule kind and cannot be switched off.

## 6. Files

Kept from the draft after a re-read (changed only where a rule above requires it):

- `apps/worker/src/modules/commissions/use-cases/raise-parked-commission-alert/` and its spec.
- `apps/worker/src/modules/commissions/domain/{parked-commission-event,parked-alert-recipients}.ts` and specs.
- `apps/worker/src/modules/commissions/ports/parked-commission-alert.port.ts`,
  `persistence/parked-commission-alert.outbox.ts`, `events/published.ts`, `commissions.module.ts`, `index.ts`.
- `apps/worker/src/modules/identity/persistence/company-owners.ts` and `identity/index.ts`.
- `packages/contracts/src/commissions/parked-commission-event.ts`, `in-app-notifications.ts` and their specs.
- `packages/notifications/src/templates/commission-event-parked.ts`, `generic-notice.ts`, `index.ts`;
  `packages/i18n/src/in-app-catalog.ts`; the admin renderer and its spec.
- `docs/module-map.md`.

Rewritten:

- `packages/db/src/dispatcher.ts`: drop `onParked`, `logger`, `notifyParked`, `logParkedFailure`, the extracted
  `dispatchBatch` helper and `RETURNING id`; add the read-only page method and its type.
- `apps/worker/src/outbox/dispatch-loop.ts` and its spec: drop `onParked`; add the sweep with its interval, page bound
  and injected alert function.
- `apps/worker/src/main.ts`: wire the sweep instead of the hook.
- `docs/adr/0012-statement-approval-pending-outbox-count.md` (the draft's 2026-11-24 amendment, "Where it is raised")
  and the draft's `docs/runbook.md` section: describe the sweep, its interval and the restart behaviour.
- `apps/worker/src/modules/commissions/__tests__/parked-commission-alert-db.spec.ts`: see section 7.

Regenerated after merging main, never hand-merged: `packages/contracts/openapi/openapi.json` and the three
`apps/{admin,menu,pos}/src/shared/api/schema.d.ts` (`pnpm contracts:openapi` and the apps' `api:check`).

## 7. Tests

The first test written, failing before the sweep exists: **a counted event is parked and committed, no alert runs (the
process "dies"), then one sweep runs and writes exactly one bell and one mark; a second sweep writes nothing.**

The 8 unrun cases, judged against this plan:

| Case in the draft file | Verdict |
| --- | --- |
| parked after a failed delivery raises one notice to the owners | rewrite: trigger is the sweep |
| parked by an expired lease at the last attempt raises the notice too | rewrite: trigger is the sweep |
| a second park of the same event id raises nothing more | rewrite as "a second sweep raises nothing more" |
| a parked event of another type raises no notice and writes no mark | keep the assertion, new trigger; also assert the page query never returns it |
| a company with no owner gets no notice and no mark | keep; add "alerts on a later sweep once an owner exists" |
| the owners of another company receive nothing, mark not visible to that company | keep |
| a parked counted event still counts as pending for approval | keep; this is the money gate, it must run against the installed function after `ALERTED` |
| a failing alert callback never breaks the dispatch batch | replace with "one failing alert does not stop the sweep or the loop" |

New cases: the crash test above; two concurrent sweeps on one event produce one bell; the `EXPLAIN` assertion on the
page query; the page query returns no payload column; a unit test that the settled-id set skips a second transaction;
`dispatchBatch` behaviour unchanged (the existing dispatcher specs pass untouched).

## 8. Verified and not verified (2026-11-24, by reading `origin/main` at `973b56182`)

Verified:

- The pending count (`statement_pending_commission_events`, migration 0242) and the coverage report (migration 0250)
  both filter on the consumer id `commissions.project-inputs`. The `commissions.park-alert` mark therefore cannot make
  a parked event look consumed.
- `pospay_dispatcher` has `SELECT` on `outbox` and column `UPDATE` on five columns, and no privilege on
  `consumed_events` (migration 0006).
- `markEventConsumed` is one atomic insert with `ON CONFLICT DO NOTHING`.
- The dispatch loop already has a sweep slot between batches, and `stop()` waits for the tick in flight.
- The index `outbox_unpublished_idx` on `seq` where `published_at IS NULL` exists (migration 0005).

Not verified:

- That the page query actually uses that index at realistic sizes (the `EXPLAIN` test decides).
- Whether the old implementer sessions on the draft worktree are stopped. The implementer starts in a fresh worktree
  created from `1d83192e5`, so no leftover session can share the folder.
- Any behaviour of the draft code: none of it was executed by the reviewer.

## 9. Order of work and gates

1. Fresh worktree from `wip/059-53-2b2b-parked-alert` at `1d83192e5`; merge main; regenerate the generated files.
2. The failing crash test; then the page method with its `EXPLAIN` test; then the sweep; then `main.ts`.
3. Remove the hook from the dispatcher and confirm `git diff origin/main -- packages/db/src/dispatcher.ts` shows only
   the added read method.
4. Rewrite the integration file per section 7 and run it (one database slot, one run at a time).
5. ADR-0012 amendment and runbook text.
6. Local gates: typecheck, lint, `pnpm lint:docs`, `pnpm module-map:check`, the touched test folders in full
   (`packages/db/src/__tests__`, `apps/worker/src/outbox`, `apps/worker/src/modules/commissions`,
   `packages/contracts/src`). The implementer runs `clean-code-guard`, `test-guard` and `waleed-security-reviewer`.
7. One independent review with an explicit verdict on: the dispatcher file being unchanged apart from the read
   method, the exactly-once guarantee across a crash, and the money gate still refusing after `ALERTED`.
8. Pull request; exact-head `ci-gate`; bot panel. Not merged without the project manager's word.

Commits name their files (`git commit -- <files>`), one per step, pushed after each step.
