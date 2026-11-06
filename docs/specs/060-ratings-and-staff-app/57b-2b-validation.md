# 57b-2b - My leave implementation validation

Date: 2026-11-06. Implementation worktree: `F:/Dev/Worktrees/PosPay/57b-2-my-leave`.
Baseline supplied by the manager: `3fc65c268377ca01dd48e98f67529f7e16e72a97`.
UI scope only; the parallel reader author owns API/contracts/OpenAPI/generated clients.

## Delivered behavior

- Personal and reception shells expose an explicit My leave button, without a new PIN or private-view window.
  Existing passkey enrollment and attendance remain composed by their original screens.
- Personal staff select a branch from the generated `/v1/staff/me/branches` route. Leave history stays
  employee/business-wide; `branch_id` proves personal authority and is supplied on list/create/cancel.
  Reception uses the paired-device branch and does not send a branch query.
- Full-day inclusive and partial-day input uses the existing request contract, with increasing dates/times,
  at most 90 civil days, 15-minute partial slots, four types, and OTHER requiring a trimmed note up to 500 characters.
- History shows all four statuses, saved local dates/timezone, partial times, notes and returned decision/revocation
  reasons. Pagination appends pages. Only `can_cancel` exposes cancellation; it sends `expected_revision`.
- Writes have no automatic retry. Explicit retry of the same attempted command retains its Idempotency-Key.
  Cancellation invalidates history; creation pins the returned request until the next read update.
  Concurrent submit clicks are locked. Closing, branch/session changes and offline
  transitions unmount private state, abort writes and cancel/remove queries. Reads consume TanStack cancellation signals.
- Query identities contain the company, business, user, absolute session deadline, session epoch and branch.
  Queries use `gcTime: 0` and `retry: false`; no private persistence or offline outbox is introduced.
- Personal transport uses credentials include, no-store and nativeStaffFetch on the existing iOS condition,
  without device middleware even when an old paired token exists. Reception retains staffApiClient.
- The personal slot is hidden after a failed session probe through `privateReady`, so retained enrollment-session
  state cannot keep a leave screen visible after failed revalidation.

## Exact authored files

- `apps/pos/src/my-leave/api/leave-calls.ts`
- `apps/pos/src/my-leave/api/use-my-leave.ts`
- `apps/pos/src/my-leave/model/context.ts`
- `apps/pos/src/my-leave/model/error-text.ts`
- `apps/pos/src/my-leave/model/use-leave-form.ts`
- `apps/pos/src/my-leave/ui/leave-form.tsx`
- `apps/pos/src/my-leave/ui/leave-history.tsx`
- `apps/pos/src/my-leave/ui/leave-panel.tsx`
- `apps/pos/src/my-leave/ui/leave-period-fields.tsx`
- `apps/pos/src/my-leave/ui/my-leave-screen.tsx`
- `apps/pos/src/my-leave/ui/my-leave-screen.spec.tsx`
- `apps/pos/src/app/app.tsx`
- `apps/pos/src/app/employee-flow.tsx`
- `apps/pos/src/app/reception-body.tsx`
- `apps/pos/src/app/own-leave-entry.tsx`
- `apps/pos/src/app/personal-leave.tsx`
- `apps/pos/src/personal-staff/ui/personal-screen.tsx`
- `apps/pos/src/personal-staff/api/use-personal-session.ts` (readiness field for the new slot)
- `apps/pos/src/staff-login/ui/staff-login-screen.tsx`
- `packages/i18n/src/catalog.ts`
- `packages/i18n/src/my-leave-catalog.ts`
- `packages/i18n/src/my-leave-catalog.spec.ts`
- This validation receipt.

## Local commands and receipts

All commands used the explicit implementation worktree. No git command was run.

- `pnpm --filter @pospay/pos typecheck` - passed after dependencies and own initial type errors were corrected.
- `pnpm --filter @pospay/pos lint` - passed after splitting form/command responsibilities and removing non-null assertions.
- `pnpm --filter @pospay/i18n typecheck` - passed.
- `pnpm --filter @pospay/i18n lint` - passed.
- `pnpm lint:docs` - passed, zero errors and 29 pre-existing TODO warnings.
- `pnpm module-map:check` - passed, including boundary/cycle checks provided by this command.
- `pnpm --filter @pospay/pos exec vitest run src/my-leave/ui/my-leave-screen.spec.tsx src/app/app.spec.tsx src/app/employee-flow.spec.tsx src/app/reception-body.spec.tsx src/personal-staff/ui/personal-screen.spec.tsx src/personal-staff/api/use-personal-session.spec.tsx src/staff-login/ui/staff-login-screen.spec.tsx --pool=threads --maxWorkers=1`
  - passed, 7 files / 41 tests, followed by the final own-leave run below.
- `pnpm --filter @pospay/i18n exec vitest run src/my-leave-catalog.spec.ts --pool=threads --maxWorkers=1`
  - passed, 1 file / 1 test.
- Scoped `pnpm exec prettier --write` ran only on the authored files.

The first POS typecheck found missing shared-package outputs. Prerequisite compilation ran with
`pnpm --filter @pospay/domain --filter @pospay/i18n --filter @pospay/contracts build` and
`pnpm --filter @pospay/auth build`. pnpm also automatically materialized this worktree's dependencies.
No application build or heavy check was run.

The first Vitest forks invocation failed before executing tests with
`[vitest-pool-runner]: Timeout waiting for worker to respond`. The threads pool ran successfully.
An intermediate text-encoding correction briefly introduced an invalid ternary token; it was corrected before the passing runs. Intermediate test failures exposed a mock cancel-path query-string comparison and leaked offline-manager state
between tests; both were corrected. The explicit entry button also preserves shell tests without opening data queries.

The final own-leave run adds a late-response/session-replacement regression: 1 file / 13 tests passed, using the same scoped command with only src/my-leave/ui/my-leave-screen.spec.tsx.

## Guard pass and limits

Applied clean-code-guard, test-guard and docs-guard: shared contract reused, no component fetch, no cross-area
component/hook imports outside app composition, visible UI assertions with network-boundary mocks, no mock-only UI test,
no handwritten branches API type or generated artifact edit, and documentation claims checked against source/receipts.

No DB, migration, full pnpm check, Playwright, application build, browser/device smoke, commit, push, PR, merge,
deployment, manual review request or cleanup was performed. Native device execution is not claimed.
Implementation is ready for the parent's stacked UI assembly and exact-head CI/review gates; this does not complete
attendance or all of roadmap row 57b-2.

## Parent review corrections and verification

Independent Astra high review completed with two P2 findings and one P3, no P0/P1
or confirmed identity leak. The parent addressed all three before opening the PR:

- Reception composition uses the existing `authenticatedSession` during background
  session probes, retaining entered dates and idempotency state while the same session
  is being checked. Failed revalidation still removes the form. A real hook/screen/network
  integration test in `app/own-leave-entry.spec.tsx` covers both outcomes visibly.
- Leave history polls every 15 seconds so external manager decisions update the status
  and cancellation action. A controlled-clock test observes removal of the pending status
  and cancellation button after an external approval.
- The selected personal branch's actual timezone is displayed beside the form, including
  on an empty history. The screen also declares locale direction explicitly and the Arabic
  visible-screen test asserts RTL.

The parent reran the 7 original POS files (42 tests), the i18n test and contract test;
all passed before these corrections. After corrections the two targeted UI files passed
15 tests, POS typecheck and lint passed, and documentation/module-map gates passed.
The first polling regression attempt installed fake timers after the existing interval
had been created, so it failed without advancing that interval; timers now start before
mounting the real query. One test callback type annotation was also corrected before the
passing typecheck. Neither failure required weakening an assertion.

Final verification after the RTL assertion: all 8 selected POS test files passed,
44 tests total; POS typecheck and lint passed again. This includes the real reception
session-probe composition regression and polling/timezone test. The UI PR is stacked
on the 57b-2a reader branch; generated clients and API changes belong to that base PR.

## PR correction round 1

The UI branch was rebased locally onto reader head
`3fce8d37f0f5930ec784c29aea758bb73ad94a76`. All four panel bots and Codex
completed on `a7c3aea07540dbfd974ead272423bebab1a4abcb` before one consolidated
correction push (PP-119.1); CI on that original UI head passed.

Accepted findings from Codex, MergePilot and Waleed on that remote head:

- Creation now follows the current branch's presence in the returned
  `request_branch_ids`; read history and permitted cancellation remain available.
- Reception's timezone comes from the existing attendance QR's verified branch
  metadata, passed through app composition. No second discovery API call or
  device/session contract change is introduced. The form waits for the timezone;
  the read-only history remains available while it is being obtained.
- Failed background history or branch reads retain cached UI and the entered draft,
  with an error shown alongside it. Initial failures without data still show the
  refusal/retry state. Session rejection/offline/identity cleanup remains unchanged.

The parent added visible creation-authority and draft-preservation regression tests
and reception timezone assertions. `BranchLeave` now occupies its own component file,
and an initial branch-query failure offers an explicit retry, covered by a visible
recovery test. Four affected UI test files passed 24 tests after all changes. An initial
recovery assertion ran before TanStack's UI notification; it now waits for the alerts
to disappear, retaining the same assertion. Attendance composition's effect was
extracted into a local hook to keep the existing 60-line component gate. No test was
skipped or weakened. POS lint and typecheck, documentation and module-map checks
all passed after these corrections. All seven inline findings are addressed; duplicates
refer to the same background-error and reception-timezone fixes.

## PR correction round 2

The manager approved the base-only rebase onto `main`; its published head is
`9fa051ff178aca291ed1b10c6611662337e2ac57`. Range-diff preserved both UI patches,
so that maintenance push did not consume a correction round.

Further review identified two real issues, including repeats from the pre-rebase head:

- Authentication/authorization refusals are distinguished from transient errors by
  HTTP status. A 401/403/404 immediately hides cached branch/history controls and
  the form; an effect removes the affected query. Five visible regressions verify
  history/draft disappearance and removal of cached private reasons. A transient
  503 still preserves the entered draft and recovers without reopening the screen.
- Personal sign-in, session probe, passkey operations and sign-out now share a
  credential-only `personalApiClient` with leave reads/writes. It selects the existing
  native iOS transport without Device middleware. Personal attendance and push call
  wrappers also reuse it, avoiding a remaining cookie-transport mismatch after login.
  An SDK-boundary regression proves login/probe/leave/sign-out use the same native
  path and that reads refuse after sign-out. This is not an on-device cookie-jar test.

The parent ran five affected test files, 51 tests, plus four regression files for
attendance/push/session/reception, 15 tests; all passed. POS typecheck/lint and
documentation/module-map checks passed before the final mechanical wrapper changes.
No API contract, migration, server, secret, environment or native configuration changed.
The manager chose option (a) for r4490324543 after advisor consultation (PP-136):
keep D-A11/MY-16 and the API's oldest-first order. The create response is pinned in
an «آخر طلب» card above history until the next successful history update. Creation
does not immediately invalidate the current page, so this confirmation remains visible
until that update. The card has no inferred cancellation authority; its status is the
server's create response. A visible test with 20 older rows asserts the status inside
the pinned region and its disappearance at the next update. The separately scoped
newest-first follow-up is [#885](https://github.com/lolotam/PayPos.systems/issues/885),
opened before merge. No API ordering change was made.

All four panel bots completed on `9fa051ff178aca291ed1b10c6611662337e2ac57`
before the consolidated round-2 push. Codex also completed on that head with no
findings. The final parent run after the card, transport and refusal corrections
passed nine POS test files / 68 tests, plus the i18n test. POS typecheck/lint passed
again, and documentation/module-map checks passed. The earlier 51+15 counts above
describe intermediate verification, not the final total. The first final lint attempt
found a 61-line component; removing a redundant local display variable restored the
60-line gate without changing behavior. No production API or database tests were
needed because their code/contracts remained unchanged.


## PR correction round 3

All four panel bots completed on `d5df7f0cfe1065b429f0908d46aa8c70b6964533`
before this consolidated correction. The remaining confirmed findings concern
write refusals and session-wide branch metadata:

- Create/cancel 401/403/404 now use the same refusal cleanup as reads. The panel
  hides private form/history immediately, removes the refused query and suspends
  automatic history reads after write refusal. Explicit retry restores controls
  only after a successful fresh read.
- A 401 removes the whole identity's leave-query namespace, hides the branch
  selector and stops branch reads until that screen/session scope is replaced.
  Branch-specific 403/404 keep narrower cleanup. Seven parameterized visible
  write-refusal regressions cover personal/reception create and cancellation;
  existing read-refusal tests additionally assert hidden selector and cleared
  branch cache after 401. Transient 503 draft-preservation tests remain unchanged.
- Finding r4490449050 is not reproduced and contradicts the installed Capacitor
  8.5.3 native source. iOS `HttpRequestHandler.swift` lines 160?167 parses
  `application/json` before the `.text` branch; Android `HttpRequestHandler.java`
  lines 240?265 also parses JSON content type before response-type conversion.
  The existing JSON serialization and JSON-string-fragment regression are retained;
  only an Arabic rationale comment was added. No device smoke is claimed.

Final affected regression run: nine POS files, 61 tests passed, including the
native transport, authentication/session, attendance and push call regressions.
The write cases were split into a separate test file to retain the 400-line
file limit. An initial run exposed cache refilling after write refusal; disabling
automatic reads while refused fixed it without weakening the cache assertions.
The lifetime cleanup hook was extracted to retain the 60-line function limit.


The final seven-case write-refusal recheck also proves visible recovery after an
explicit retry succeeds for branch-scoped refusals. Global `pnpm typecheck`,
`pnpm lint`, `pnpm lint:docs` and `pnpm module-map:check` passed. Existing lint
warnings remain non-blocking. `git diff --check` passed. Parent guard passes:
clean-code-guard (shared refusal policy, bounded functions, no API/native behavior
change), test-guard (network-boundary mocks, real query cache, visible positive and
negative assertions) and docs-guard (claims checked against source and receipts).
Exact-head CI and external reviews remain pending after this round-3 push.
