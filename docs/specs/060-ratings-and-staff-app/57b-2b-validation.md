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
  Success invalidates the history; concurrent submit clicks are locked. Closing, branch/session changes and offline
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
