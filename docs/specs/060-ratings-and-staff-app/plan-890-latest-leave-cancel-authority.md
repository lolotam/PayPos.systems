# Plan — E2 / issue #890: «آخر طلب» can be cancelled, with the authority decided by the server

Date: 2026-11-20. Base: `origin/main` at `463707bb7`. Branch: `fix/890-latest-leave-cancel-authority`.
Tier: MEDIUM (Waleed's card, 2026-11-20). Follow-up to 57b-2b (#882, review r4494761636) and #885.

## 1. What changes

The two own write routes, `POST /v1/staff/me/leave-requests` and
`POST /v1/staff/me/leave-requests/{leaveId}/cancel`, return the written request **plus one server-decided flag
`can_cancel`**. The POS «آخر طلب» card shows «إلغاء الطلب» only when that flag is `true`. The client never infers
authority (not from `PENDING`, not from a successful create).

Unchanged: the admin employee routes (their POST responses stay `LeaveRequest`), the manager inbox, the own
`GET` list, the cursor, the database schema. **No migration.**

## 2. Where the flag comes from (the authority contract)

- **Never stored.** The write's idempotent stored body stays exactly the `LeaveRecord` it is today. `can_cancel`
  is computed **after** the write transaction, on every response including an idempotent replay, so a replay
  after the request was cancelled or after a permission change answers with today's authority, not the old one.
- **Live, in its own transaction.** The controller, after the use case returns, runs one bounded read in a new
  `withTenant(companyId, …, { userId })` transaction (sequential, never nested — CLAUDE.md §6 connection budget).
- **One rule, the list's rule.** The read uses `LeaveReadAccess.check` with the same own context the own list
  uses (`own: true`, the session's `branchId`; personal sessions also pass `employeeId`, exactly as
  `ownLeaveActor` builds it), and projects the flag through the **same** `leaveListRecord(...)` expression the
  list rows use, so the card and the history row can never disagree. For own reads `cancelBranches` is every
  business branch when cancel is granted on the session branch — the same rule `resolve()` applies to the write
  (authority on the session branch, the record may sit at another branch).
- **Bounded.** One row by primary key: `company_id`, `business_id`, the caller's own `employee_id` from the
  access scope, and `l.id = leaveId`, with the same branch-scope predicate as the list. No paging.
- **Refusal = `false`.** If the access check returns `null`, the feature is disabled, the row is not visible, or
  the read itself throws, the write has already committed, so the route still answers 201/200 with the record
  and `can_cancel: false`. `false` means "the server did not confirm cancel authority"; it is never `true` by
  default. No logger is injected into the own-leave controller, so a read failure is not logged (no new
  logging dependency was added). A confirmed cancel answers `can_cancel: false` without a second read.

## 3. Code (implementer)

Production files allowed:

1. `packages/contracts/src/staff/leave.ts` — `ownLeaveWriteResult = leaveRequest.extend({ can_cancel: z.boolean() })`
   with `.meta({ id: 'OwnLeaveWriteResult' })`, its type `OwnLeaveWriteResult`, and add it to `leaveSchemas`.
2. `packages/contracts/src/staff/leave-openapi.ts` — the two own POST operations respond with
   `OwnLeaveWriteResult`. Parameterise the existing `operation()` helper with an optional response schema name
   (default unchanged); every other operation's output stays byte-identical.
3. `packages/contracts/src/response-object.spec.ts` — register the new schema in its list.
4. `packages/contracts/openapi/openapi.json` and the generated `schema.d.ts` of `apps/pos`, `apps/admin`,
   `apps/menu` — regenerated only through `pnpm contracts:openapi` and each app's `api:generate`. Never hand-edit.
5. `apps/api/src/modules/staff/queries/leave-requests.query.ts` — new export
   `ownLeaveCancelAuthority(tx, context, leaveId, access): Promise<boolean>` (one Arabic line above it: which
   screen consumes it and why it is read live). It is a **separate small statement**; do **not** change
   `leavePageSql` — `leave-open-list.spec.ts` pins the sha256 of its default SQL text.
6. `apps/api/src/modules/staff/http/own-leave.controller.ts` and, if useful, `http/leave-http.ts` — `request` and
   `cancelRequest` return `{ ...record, can_cancel }`. Keep the controller thin; the read is a call, not logic.
7. `apps/pos/src/my-leave/api/use-my-leave.ts`, `apps/pos/src/my-leave/ui/latest-leave-request.tsx`,
   `apps/pos/src/my-leave/ui/leave-panel.tsx` (and `api/refresh-cancelled-leave.ts` only if its types require):
   - `lastRequest` holds `OwnLeaveWriteResult`.
   - The card gets `busy` and `cancel`; it renders «إلغاء الطلب» (existing i18n key `leave.cancel`) only when
     `request.can_cancel === true`, calls `cancel(request.id, request.revision)`, and the button is disabled
     while `busy`.
   - After **any** confirmed cancel (from the card or from a history row) whose result id equals the card's id,
     the card is replaced by the confirmed result (status «ملغاة», `can_cancel: false`, so no button) **before**
     the history refresh, so a refresh that fails with 503 cannot leave a stale button and is not read as a
     failed cancel.
   - Keep today's refusal handling untouched: 401/403/404 (including multi-cause `NOT_FOUND`) still clear the
     private data and lock Retry; a 409 shows its error and does not clear the history.

No new i18n text is expected. No admin or menu production change beyond regenerated types.

## 4. Tests (implementer)

API — put HTTP cases on the personal-session harness (mirror `personal-leave.spec.ts`; do not grow
`leave-http.spec.ts`, which is at 342 lines). New file
`apps/api/src/modules/staff/__tests__/own-leave-cancel-authority.spec.ts` (split if it nears 300 lines):

- **Allowed:** own create → 201, body parses with `ownLeaveWriteResult`, `can_cancel: true`; cancelling with the
  returned `id` and `revision` → 200, body `status: 'CANCELLED'`, `can_cancel: false`.
- **Refused (real authority refusal):** a user who may create but whose cancel permission is denied (use the
  DENY/grant setup style the existing leave HTTP specs use) → create 201 with `can_cancel: false`, and the cancel
  call is refused with the existing named error.
- **Replay is live:** create with key K, cancel it, replay the create with key K → same record id, and
  `can_cancel: false` (authority re-read, not stored).
- **Isolation:** the flag is never `true` for a request the caller did not make (e.g. made for her by a manager)
  and never leaks another tenant; reuse the existing own-scope patterns.
- **Query result shape + EXPLAIN (CLAUDE.md §9)** for `ownLeaveCancelAuthority`: true/false/unknown-id cases, and
  `EXPLAIN (ANALYZE, FORMAT JSON)` shows a bounded single-row index lookup on one of the leave_requests indexes whose columns are all bound (the planner does not deterministically pick the pkey), with no Seq Scan and no Sort.

Contracts: a test that `ownLeaveWriteResult` accepts a record with `can_cancel` and rejects one without it, and
that the own POST operations in the generated OpenAPI reference `OwnLeaveWriteResult` while the admin POST
operations still reference `LeaveRequest`.

POS — new file `apps/pos/src/my-leave/ui/latest-leave-cancel.spec.tsx` (mirror `leave-creation-card.spec.tsx`
setup; do not grow the 384-line `my-leave-screen.spec.tsx`). Visible assertions only, mock calls only beside them:

- History page loaded **without** the new request (so the card is the only place to cancel it), create returns
  `can_cancel: true` → the card shows «Cancel request»; clicking sends the card's id and `expected_revision`;
  the button is disabled while the request is in flight; the card then shows «Cancelled» with no button.
- Create returns `can_cancel: false` → the card has no «Cancel request» button.
- Cancel succeeds but the history refresh answers 503 → the card still shows «Cancelled» with no button.
- Cancelling the same request from its history row also updates the card (no stale button).
- Cancel refused with 403/404 → private data cleared and Retry locked exactly as today; 409 → error shown,
  history kept.

## 5. Docs (orchestrator, already in this branch — do not edit)

Spec 060 (D-A11 amendment, MY-16c), `docs/journey/84-my-leave.md`, owner-questions entry.

## 6. Bans and gates

- No git commands of any kind. No `.env`, no secrets, no other worktree, no container start/stop. No migration, no
  schema change, no new dependency.
- Edit only the files named in §3 and the tests of §4. No unrelated reformatting, no line-squashing, no renames.
- If anything here needs a migration, a new route, or a change outside these files: STOP and report.
- Gates to run and report (exact command and result): rebuild contracts first
  (`pnpm --filter @pospay/contracts build` or the package's build script), then `pnpm contracts:openapi`, the
  three `api:generate`, `pnpm --filter @pospay/pos api:check`, `pnpm --filter @pospay/admin api:check`, typecheck
  and lint for contracts/api/pos (and admin/menu if their generated types changed), `pnpm lint:docs`,
  `pnpm module-map:check`, the contracts tests touched, and the new/touched spec files **one DB spec at a time**
  on the private lane named in the brief.
- Then read and apply `C:/Users/waleed_Mohamed/.claude/skills/clean-code-guard/SKILL.md` and
  `C:/Users/waleed_Mohamed/.claude/skills/test-guard/SKILL.md` to your own diff, fix what they find, re-run the
  affected gates, and end with ONE consolidated report: files changed with line counts, each gate's result,
  guard findings and fixes, anything not done.
