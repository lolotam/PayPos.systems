# Plan 53-2 B2b: the parked commission event alert (durable)

Scope: ADR-0012 section 3 ("raise an owner-visible operational alert" when a counted commission event is parked) and
its section 4 group 5. Tier: Heavy (outbox, one index-only migration). Implementer: Claude Sonnet 5.5 only, plus one
independent review and the bot panel (PP-266). No new database grant and no new role privilege.

This plan replaces the delivery design of the saved draft. Revision 2 (2026-11-24) folds in one read-only discussion
round with Kimi K3.1 Pro; section 9 records what that round changed. The plan was written from a read of the code;
nothing was run. Section 8 lists what was verified and what was not.

## 1. Where the work stands

- Draft branch `wip/059-53-2b2b-parked-alert` at `1d83192e5`, based on `be573e648`, 14 commits behind main
  `973b56182`. `git merge-tree` reports no textual conflict with main.
- 37 files, +1442/-30. About 890 hand-written production lines by MiniMax M3.1 Flash, one test edit by Big Pickle, one
  integration file of 8 cases by HY4 Flash. No migration in the draft.
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
   parked counted events: `id`, `company_id`, `event_type` and `seq` only, for rows with `parked_at IS NOT NULL`,
   `published_at IS NULL` and `event_type` in the six counted types, ordered by `seq`, after a `seq` cursor, with a
   bounded limit. It asserts the role like the replay pages do. It reads no payload and writes nothing. The cursor
   travels as a decimal string or `bigint`, never a JavaScript number.
2. **Alert (application role, per event).** For each row the sweep calls the use case `RaiseParkedCommissionAlert`
   under `withTenant(company_id)`. The mark `consumed_events` with consumer id `commissions.park-alert` and the notice
   request are written in that one transaction, so they commit or roll back together.

Why two steps and not one anti-join: `pospay_dispatcher` holds `SELECT` on `outbox` only and has no privilege on
`consumed_events` (migration 0006). One query would need a new grant and a new exception in `CLAUDE.md` section 5. The
use case is idempotent, so the second step can be repeated safely.

Why the hook goes: with the sweep as the guarantee the hook is only a latency shortcut, and it is the part that
changes `dispatchBatch` and `recordQuery` in the most sensitive file of the repository. Removing it returns
`dispatchBatch` and `recordQuery` to their text on main. A notice that arrives within one sweep interval is acceptable
for an event that blocks a monthly approval. No latency requirement exists that would justify keeping it.

**The guarantee, stated exactly.** After a park of a counted event that still blocks approval is committed, exactly
one durable notice request (`CommissionEventParkedNoticeRequested`, one per recipient group) is written for that event
id, whatever happens to the worker process in between, as long as the worker runs again. Turning that request into the
owner's `in_app_notifications` row is the existing notification consumer's job and inherits its delivery handling: if
the notice request itself is parked, the dispatcher logs `outbox event parked` and no bell exists. That case is not
solved by this slice and is stated in ADR-0012.

### 3.1 Only approval-blocking events alert

A parked counted row does not always block approval. The pending count (migration 0242) ignores a row that already has
the `commissions.project-inputs` mark. That happens when the commission consumer succeeded and another consumer caused
the park, and when an operator ran `replay-commission-inputs` on a parked row (the replay delivers to the consumer and
leaves `parked_at` untouched, `docs/runbook.md` 50-3a).

Inside the tenant transaction the use case therefore reads whether the `commissions.project-inputs` mark exists for
the event:

- absent: write the `commissions.park-alert` mark and the notice request, outcome `ALERTED`;
- present: write the `commissions.park-alert` mark and no notice, outcome `NOT_BLOCKING`.

Both outcomes settle the event. Reading and writing `consumed_events` is the application role's ordinary privilege.

### 3.2 The migration: one partial index, nothing else

`outbox_unpublished_idx` (`seq` where `published_at IS NULL`) is not a bounded access path for this query: parked rows
of every type are never published and never cleared, so they stay in that index for ever beside the live backlog, and
each page would read and discard them. `CLAUDE.md` section 5 also requires the migration that adds a query to add its
index.

The slice adds one migration that creates, `CONCURRENTLY`, a partial index on `outbox` (`seq`) whose predicate is
exactly `parked_at IS NOT NULL AND published_at IS NULL AND event_type IN (<the six counted types>)`. Expand-only: no
table, column, grant, policy, function or data change. The six literals in the predicate are compared by a test with
`COMMISSION_INPUT_EVENT_TYPES` in `packages/domain`, as migration 0242 does for its function.

## 4. Rules the implementer must hold

- **Interval.** Default 60 seconds, under its own option name (for example `parkedAlertIntervalMs`); the existing
  `sweepIntervalMs` of the idempotency sweep keeps its meaning and its ten-minute default. The parked sweep runs inside
  the dispatch loop tick, between batches, so `stop()` already waits for it.
- **Every sweep starts at the first row.** No wrap-around cursor is kept between sweeps. A sweep pages from `seq` 0
  upward in pages of 100 until a short page. The cursor advances only after a whole page has been processed. The cap
  is on work, not on pages: a sweep opens at most a fixed number of tenant transactions (suggested 200) and then stops
  until the next interval, logging that once. Rows already in the settled set below cost no transaction, so a later
  sweep passes over them and reaches the rows the cap left behind.
- **Settled set.** A bounded LRU of event ids (suggested 10 000), in process memory only, holds ids whose outcome was
  `ALERTED`, `NOT_BLOCKING` or `ALREADY_ALERTED`; those are skipped without a transaction. Eviction and restart are
  safe: the event is checked again and ends in `ALREADY_ALERTED`. The mark is the only source of truth; no test may
  pass because of the set alone.
- **`NO_OWNERS`.** No mark is written. Because every sweep starts at the first row, the event is tried again on the
  next sweep and alerts within one interval of an owner membership existing. The error line is logged on the
  transition into `NO_OWNERS` for an event id, remembered in a second bounded LRU; a restart logs it once more.
- **A failing alert.** An exception from one event is logged with `event.id`, `event.type` and `companyId` and does
  not stop the page, the sweep or the dispatch loop. The event is retried on the next sweep. Repeated failures of the
  same event are logged with a capped backoff (first failure, then at most once per ten minutes).
- **Two worker replicas.** Both may sweep the same event. `markEventConsumed` is a single
  `INSERT ... ON CONFLICT DO NOTHING RETURNING`, so the second transaction waits for the first and then reports
  `ALREADY_ALERTED`. No advisory lock is added.
- **Six counted types only**, taken from `COMMISSION_INPUT_EVENT_TYPES` in `packages/domain`, never a second list in
  TypeScript.

## 5. What must not change

- `dispatchBatch`, `recordQuery`, `exhaustQuery`, `claimQuery` and the fence in `packages/db/src/dispatcher.ts`:
  byte-identical to main after this slice, apart from the new read method being added to the returned facade.
- The pending predicate, the consumer id `commissions.project-inputs`, the function
  `statement_pending_commission_events` and every grant and policy of ADR-0012 sections 1 and 2.
- The coverage objects of migration 0250.
- No un-park, no re-delivery, no delete of a parked row. An operator procedure that clears `parked_at` (migration 0089
  did so once for `SalaryChanged`) is outside this slice; ADR-0012 gains one sentence saying such a procedure must not
  publish a counted row without its commission effect.
- No existing test is edited to fit the new code without the reviewer's approval.
- The decisions already taken in the draft and kept: company owners as recipients (active memberships at the alert
  instant), in-app bell only, groups of at most 100 recipients, one notice per parked event id, the notice carries the
  event's type and id only (no payload, amount or name), the alert is not an alert-rule kind and cannot be switched off.

## 6. Files

Kept from the draft after a re-read (changed only where a rule above requires it):

- `apps/worker/src/modules/commissions/use-cases/raise-parked-commission-alert/` and its spec (adds the
  `NOT_BLOCKING` outcome and the projection-mark read of section 3.1).
- `apps/worker/src/modules/commissions/domain/{parked-commission-event,parked-alert-recipients}.ts` and specs.
- `apps/worker/src/modules/commissions/ports/parked-commission-alert.port.ts`,
  `persistence/parked-commission-alert.outbox.ts`, `events/published.ts`, `commissions.module.ts`, `index.ts`.
- `apps/worker/src/modules/identity/persistence/company-owners.ts` and `identity/index.ts`.
- `packages/contracts/src/commissions/parked-commission-event.ts`, `in-app-notifications.ts` and their specs.
- `packages/notifications/src/templates/commission-event-parked.ts`, `generic-notice.ts`, `index.ts`;
  `packages/i18n/src/in-app-catalog.ts`; the admin renderer and its spec.
- `docs/module-map.md`.

New:

- One migration with the partial index of section 3.2, its Drizzle schema entry and snapshot.

Rewritten:

- `packages/db/src/dispatcher.ts`: drop `onParked`, `logger`, `notifyParked`, `logParkedFailure`, the extracted
  `dispatchBatch` helper and `RETURNING id`; add the read-only page method and its type.
- `apps/worker/src/outbox/dispatch-loop.ts` and its spec: drop `onParked`; add the parked sweep with its own interval,
  page bound, bounded sets and injected alert function. If the file would pass the 400-line limit, the sweep moves to
  its own file beside it.
- `apps/worker/src/main.ts`: wire the sweep instead of the hook.
- `docs/adr/0012-statement-approval-pending-outbox-count.md` (the draft's 2026-11-24 amendment) and the draft's
  `docs/runbook.md` section: describe the sweep, its interval, the exact guarantee of section 3, the `NOT_BLOCKING`
  rule, the restart behaviour and the new index.
- `apps/worker/src/modules/commissions/__tests__/parked-commission-alert-db.spec.ts`: see section 7.

Regenerated after merging main, never hand-merged: `packages/contracts/openapi/openapi.json` and the three
`apps/{admin,menu,pos}/src/shared/api/schema.d.ts` (`pnpm contracts:openapi` and the apps' `api:check`).

## 7. Tests

The first test written, failing before the sweep exists (**missed-trigger recovery**): a counted event is parked and
committed and no alert runs; one sweep writes exactly one notice request and one mark; a second sweep, run by a
**fresh sweep instance with empty memory**, writes nothing.

The 8 unrun cases, judged against this plan:

| Case in the draft file | Verdict |
| --- | --- |
| parked after a failed delivery raises one notice to the owners | rewrite: trigger is the sweep; keep this park mechanism |
| parked by an expired lease at the last attempt raises the notice too | rewrite: trigger is the sweep; keep this second park mechanism |
| a second park of the same event id raises nothing more | rewrite as a second sweep by a fresh instance with empty memory |
| a parked event of another type raises no notice and writes no mark | keep the assertion; also assert the page query never returns it |
| a company with no owner gets no notice and no mark | keep; add repeated empty sweeps, then exactly one notice after an owner exists |
| the owners of another company receive nothing, mark not visible to that company | keep |
| a parked counted event still counts as pending for approval | keep; the money gate, run against the installed function after `ALERTED` |
| a failing alert callback never breaks the dispatch batch | replace: one failing alert does not stop later events in the page, and its own later retry succeeds |

New cases:

- **Crash after commit.** The alert transaction commits, the process stops before the id enters the settled set; a
  fresh sweep instance re-reads the same page and writes no second notice.
- **Two replicas.** Two sweeps on two real database connections race on one event; one notice request exists.
- **`NOT_BLOCKING`.** A parked counted event that already has the `commissions.project-inputs` mark gets the
  park-alert mark and no notice, and the pending count for it is 0.
- **Late park below the cursor.** An event with an older `seq` is parked after an earlier sweep passed it; the next
  sweep alerts it.
- **End to end.** After `ALERTED`, running the notification consumer on the notice request produces exactly one
  `in_app_notifications` row per owner.
- **Query plan.** `EXPLAIN (ANALYZE, FORMAT JSON)` after seeding parked counted rows, many parked rows of other types,
  ordinary unpublished rows and published rows, then `ANALYZE`. For the first page and for a `seq > cursor` page: no
  `Seq Scan` on `outbox`; an ordered index scan on the new index with the cursor in the index condition; no `Sort`
  node; no rows removed by a filter for the parked or type predicates; actual rows at most the page limit.
- The page query returns no payload column.
- The index predicate's six literals equal `COMMISSION_INPUT_EVENT_TYPES`.
- Unit: the settled set skips a second transaction; eviction leads to one extra `ALREADY_ALERTED` and no notice.
- `dispatchBatch` behaviour unchanged: the existing dispatcher specs pass untouched.

## 8. Verified and not verified (2026-11-24, by reading `origin/main` at `973b56182`)

Verified:

- The pending count (`statement_pending_commission_events`, migration 0242) and the coverage report (migration 0250)
  both filter on the consumer id `commissions.project-inputs`. The `commissions.park-alert` mark therefore cannot make
  a parked event look consumed.
- `pospay_dispatcher` has `SELECT` on `outbox` and column `UPDATE` on five columns, and no privilege on
  `consumed_events` (migration 0006).
- `markEventConsumed` is one atomic insert with `ON CONFLICT DO NOTHING`.
- The dispatch loop has a sweep slot between batches, and `stop()` waits for the tick in flight.
- The draft's notifier writes an outbox notice request, not the `in_app_notifications` row (read in the draft's
  `persistence/parked-commission-alert.outbox.ts`).

Not verified:

- Any query plan: no `EXPLAIN` was run by the author or by the discussion round.
- The line references the discussion round gave for the notification consumer, the replay tool and migration 0089
  were not re-read by the author; the implementer confirms them before relying on them.
- Whether the old implementer sessions on the draft worktree are stopped. The implementer starts in a fresh worktree
  created from `1d83192e5`, so no leftover session can share the folder.
- Any behaviour of the draft code: none of it was executed by the reviewer.

## 9. What the discussion round changed (Kimi K3.1 Pro, read-only, 2026-11-24)

Verdict: approve with changes. Seven findings; all were accepted, two in a simpler form.

1. The existing unpublished index is not a bounded access path: accepted, section 3.2 adds the partial index. This
   turns the slice into a migration slice.
2. `NO_OWNERS` retry and logging were under-specified: accepted. Instead of a separate due-retry collection, every
   sweep now starts at the first row, which the new index makes cheap.
3. The crash test did not prove the guarantee: accepted. Fresh-instance sweeps, the crash-after-commit case, the
   two-connection race and the late-park case are in section 7.
4. The settled set was unbounded: accepted, bounded LRU.
5. "The bell is written exactly once" overstated the use case: accepted. The guarantee is one durable notice request;
   an end-to-end assertion is added; a parked notice request is declared out of scope.
6. Replay and re-delivery were undecided: accepted. Section 3.1 alerts only approval-blocking events, and the claim
   that no path ever clears `parked_at` was removed.
7. Separate interval name, non-number `seq` cursor, `companyId` in failure logs: accepted.

## 10. Order of work and gates

1. Fresh worktree from `wip/059-53-2b2b-parked-alert` at `1d83192e5`; merge main; regenerate the generated files.
2. The migration and its schema entry, built and tested on a private database cluster; the migration lane is taken
   only for the final step, on the project manager's word.
3. The failing missed-trigger test; then the page method with its `EXPLAIN` test; then the sweep; then `main.ts`.
4. Remove the hook from the dispatcher and confirm `git diff origin/main -- packages/db/src/dispatcher.ts` shows only
   the added read method.
5. The `NOT_BLOCKING` rule in the use case with its unit and database tests.
6. Rewrite the integration file per section 7 and run it (one database slot, one run at a time).
7. ADR-0012 amendment and runbook text.
8. Local gates: typecheck, lint, `pnpm lint:docs`, `pnpm module-map:check`, the touched test folders in full
   (`packages/db/src/__tests__`, `apps/worker/src/outbox`, `apps/worker/src/modules/commissions`,
   `packages/contracts/src`). The implementer runs `clean-code-guard`, `test-guard` and `waleed-security-reviewer`.
9. One independent review with an explicit verdict on: the dispatcher file being unchanged apart from the read
   method, the one-notice-request guarantee across a crash, the `NOT_BLOCKING` rule, and the money gate still refusing
   after `ALERTED`.
10. Pull request; exact-head `ci-gate`; bot panel. Not merged without the project manager's word. The staging deploy
    takes a PP-129 snapshot before `migrate`.

Commits name their files (`git commit -- <files>`), one per step, pushed after each step.
