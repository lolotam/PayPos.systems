# Plan — E1 / issue #885: the employee's own leave history lists newest first

Date: 2026-11-20. Base: `origin/main` at `e0e0e642e`. Branch: `fix/885-own-leave-newest-first`.
Tier: MEDIUM (Waleed's card, 2026-11-20). Follow-up to 57b-2b (#882), spec 060 D-A11 / MY-16 / MY-16b.

## 1. What changes

`GET /v1/staff/me/leave-requests` (the «إجازاتي» screen, `OwnLeaveController.list`) returns the caller's requests
**newest first**. Nothing else changes: not the admin employee list
(`GET /v1/businesses/{businessId}/employees/{employeeId}/leave-requests`, with or without `open=true`), not the
manager inbox, not the leave-history report routes of spec 068.

## 2. The ordering and cursor contract

- **Order key: `l.id` descending, and nothing else.** `leave_requests.id` is a UUID v7 minted at creation, so id
  order is creation order, and the id is unique inside the tenant, so it is a total order: it is its own
  tie-breaker. A `(requested_at, id)` key is deliberately not used: it would change the cursor's shape and need a
  new index.
- **Cursor:** still the bare id of the last item of the page (`next_cursor`), same query parameter, same Zod
  schema (`ownLeaveListQuery`), same response (`LeavePage`). The next page is `l.id < cursor`.
- **Stability:** a request created while she pages has a larger id than every cursor already handed out, so it can
  only appear on a fresh first page; later pages never skip or repeat a row that existed when paging began.
  A decision or cancellation changes a row's status but never its id, so the row keeps its place.
- **Compatibility:** the only consumer of the own route is `apps/pos/src/my-leave` (the «PosPay Business» shell
  wraps the same build). It treats `next_cursor` as opaque and never sorts, so an older bundle keeps working with
  no change. A bundle that holds an ascending cursor from before the deploy gets one page of rows it already shows
  (React keys by id make that visible as a short repeat at worst, never a lost row); the screen's 15-second refetch
  re-reads from the first page and corrects it. No `order` parameter is added: one consumer, one order.
- **Index: none added, no migration.** `leave_requests_company_employee_id_idx (company_id, employee_id, id)`
  (migration 0062) already serves this read through a backward index scan. **If the EXPLAIN test of §4 cannot be
  met with the existing indexes, STOP and report; do not write, generate or number a migration.**

## 3. Code (implementer)

Only these production files:

1. `apps/api/src/modules/staff/queries/leave-requests.query.ts`
   - `leavePageSql` gets a fifth parameter `order: 'oldest' | 'newest' = 'oldest'`. With `'newest'` the cursor
     predicate is `l.id < cursor` and the statement ends `ORDER BY l.id DESC`; with `'oldest'` the SQL text is
     exactly what it is today.
   - `page(...)` takes the same `order` and passes it through. `next_cursor` stays the last returned item's id.
   - New export `ownLeaveHistory(tx, context, query: OwnLeaveListQuery-shaped { limit, cursor? }, access)`: the
     same scope and flags as `employeeLeaveHistory`, order `'newest'`. Like today's own read it ignores
     `branch_id` as a filter (the branch only selects the personal session) and does not accept `open`/`as_of`.
     One Arabic line above it: which screen consumes it and why newest first (CLAUDE.md §3.1, `queries/**`).
   - `employeeLeaveHistory` and `pendingLeaveInbox` keep today's behaviour and signature. The direction is an
     explicit argument; **never derive it from `context.own`**.
2. `apps/api/src/modules/staff/http/own-leave.controller.ts`: `list` calls `ownLeaveHistory` instead of
   `employeeLeaveHistory`. Nothing else in the controller changes (guards, `withTenant`, error mapping).

No contract, OpenAPI, generated `schema.d.ts`, i18n or POS production change is expected: the request and
response shapes are identical and the screen renders pages in the order received. Check
`apps/pos/src/my-leave/api/refresh-cancelled-leave.ts` and `use-my-leave.ts` for an order assumption; if you find
one, report it before changing it.

## 4. Tests (implementer)

API, in `apps/api/src/modules/staff/__tests__/` (real Postgres, existing leave fixtures). Put the new cases in a
new file `own-leave-newest-first.spec.ts`; do not grow a file past 300 lines.

- **Result shape + order:** `ownLeaveHistory` returns `LeavePage`-valid items (`leavePage.parse`), newest id first.
- **Pagination, at least 5 rows, `limit: 2`:** walking the cursors returns every row exactly once in descending id
  order and ends with `next_cursor: null`.
- **Insert mid-pagination:** read page 1, create a new request, read page 2 with the old cursor: page 2 is exactly
  what it would have been (no skip, no repeat); a fresh first page then starts with the new request.
- **Decision keeps its place:** cancel (or approve) the newest request; a fresh first page still starts with it,
  showing the new status.
- **Own scope untouched:** the read still returns only the caller's employee and `null` (→ 404) when the employee
  is unlinked/out of scope; reuse the existing assertions' style, do not weaken any existing one.
- **Admin list and inbox unchanged:** one assertion that `employeeLeaveHistory` over the same rows is still
  ascending, and no assertion in `leave-open-list.spec.ts`, `leave-decision-queries.spec.ts`,
  `leave-history-*.spec.ts`, `leave-clock.spec.ts`, `leave-feature-clock.spec.ts` changes.
- **EXPLAIN (CLAUDE.md §9):** `EXPLAIN (ANALYZE, FORMAT JSON)` of `leavePageSql(..., 'newest')` for one employee
  (with and without a cursor) must show an **Index Scan Backward on `leave_requests_company_employee_id_idx`**
  and **no `Sort` node**. Seed enough rows (other employees too) that the planner's choice is meaningful; do not
  loosen the check to "any leave index", and do not use `enable_sort=off`. If it cannot be met: STOP (§2).
- **HTTP:** in the existing own-route HTTP specs (`leave-http.spec.ts`, `personal-leave-history.spec.ts`,
  `personal-leave.spec.ts`, `leave-privacy.spec.ts`, `personal-eligibility-midnight.spec.ts`,
  `leave-decision-http.spec.ts`) update only assertions that depended on the old ascending order of the own
  route, and add one HTTP case: two requests, `GET /v1/staff/me/leave-requests?limit=1` returns the newer one and
  a cursor that fetches the older one.

POS, new file `apps/pos/src/my-leave/ui/leave-newest-first.spec.tsx` (mirror the setup of
`my-leave-screen.spec.tsx`; that file is at 384 lines, do not add to it):

- Two pages from the stubbed API in newest-first order; assert the **visible order on screen** (the list items'
  text in DOM order: newest first, and after «Next page» the older ones below, earlier pages kept). A mock-call
  assertion alone is not accepted (CLAUDE.md §9).
- After a successful create, the refetched first page shows the new request at the top of the history.

## 5. Docs (orchestrator, already in this branch — do not edit)

`docs/specs/060-ratings-and-staff-app/spec.md` (D-A11 note, MY-16b), `docs/journey/84-my-leave.md`.

## 6. Bans and gates

- No git commands of any kind. No `.env`, no secrets, no other worktree. No migration, no schema change.
- Edit only the files named in §3 and the test files of §4. No unrelated reformatting, no line-squashing, no
  renames.
- Gates to run and report (exact command and result): `pnpm --filter @pospay/api typecheck`, lint on the touched
  packages, `pnpm lint:docs`, `pnpm module-map:check`, the new and touched spec files only (DB specs need a
  Postgres lane: use the one named in the brief; never the shared cluster, never a scratch database of your own).
- Then read and apply `C:/Users/waleed_Mohamed/.claude/skills/clean-code-guard/SKILL.md` and
  `C:/Users/waleed_Mohamed/.claude/skills/test-guard/SKILL.md` to your own diff, fix what they find, and end with
  ONE consolidated report: files changed with line counts, each gate's result, guard findings and fixes, anything
  not done.
