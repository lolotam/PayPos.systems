# #901 — ended-attachment eligibility design

Status: implementation written; scoped local validation completed; independent review and CI pending. SOURCE UNBLOCKED under the manager's bounded execution handoff, 2026-11-08.

Inspected head: `ec26930497f25213b62e2b60bc603af6b9ba3527`.
Issue: https://github.com/lolotam/PayPos.systems/issues/901

## Consultation receipt

The Fable consultation failed because of its usage limit and supplied no advice. The owner then instructed verbatim: «استخدم codex astra 6 medium». A read-only native `gpt-6-astra` / `medium` advisor completed the replacement consultation. Its advice is non-binding. It recommends the design below; it does not authorize source changes. The consultation added a final-statement eligibility recheck to address concurrent attachment changes. No new business question remains after reading issue #901.

## Evidence and design

`createLeaveReadAccess.check` currently accepts any employee attachment in `access.read`, regardless of its end date. It is shared by history, open-list, inbox and own callers. `currentAttachment` already implements `to IS NULL OR to > today`, accepts injected `BranchDay[]`, and is exported from `@pospay/db`. Its future-attachment behavior is intentional for this issue: do not add `from <= today`.

Only `getEmployeeLeaveHistory` requests internal `purpose: 'history'` in its context. Add this optional discriminator to both existing context declarations; omitted purpose preserves current behavior. History eligibility data is internal and must be present for the history query to proceed; fail closed if absent. Do not expose a request parameter or HTTP contract field.

Read `clock.now()` once. Compute each readable branch's day with `scheduleToday(now, branch.effective_timezone)`, including the existing business timezone fallback supplied by business context. Use only days for known readable branches. Never call `currentAttachment()` without explicit clock-derived days in this path. Unknown/missing day data must not exploit the helper's `-infinity` fallback to grant access.

Eligibility requires at least one non-ended attachment in the employee's readable scope. An attachment ending today is ended. A future-starting attachment remains eligible under the existing end-only rule. Do not filter historic fact branches or action metadata down to branches with a current attachment: this gate controls access to the employee history as a whole.

The adapter can refuse early, but `leaveHistorySql` must also check employee existence and eligible attachment in its final `subject` CTE using explicit `currentAttachment(days)`. The same statement produces the page and `last_taken`; a false subject result returns null, which the controller maps to 404. This protects against an attachment ending or being removed after the adapter read under READ COMMITTED. No extra transaction, lock or isolation change. Existing history rows/coverage/last-taken semantics remain unchanged.

Use `scope.now` for current eligibility, not `cursor.as_of`; a valid older cursor must not restore expired eligibility. Preserve tenant/business/deletion predicates and existing branch grants.

## Approved implementation allowlist

Paths below are relative to `apps/api/src/modules/staff/` except the documentation path:

1. `persistence/leave-read-access.adapter.ts`
2. `queries/leave-requests.query.ts` — context/access types only; legacy page logic unchanged.
3. `queries/leave-history.query.ts`
4. `queries/leave-history-days.sql.ts` — internal scope type only.
5. `__tests__/leave-history-eligibility.spec.ts` — new focused tests, including legacy caller regression assertions.
6. `__tests__/leave-history-race.spec.ts`
7. `__tests__/leave-history-consistency.spec.ts`
8. `docs/plans/901-ended-attachment-eligibility.md` — this design and future validation receipt.

`packages/db/src/employee-branch-links.ts` is read-only reference. No migrations, generated artifacts, controller/contracts changes, history SQL redesign, or open-list behavior changes. Any required additional path goes back to the manager before editing it.

Approved ALL means additions plus deletions relative to the inspected baseline, including new files: source 70–125, tests 210–365, documentation 45–90, total estimate 325–580. The authorized ceiling is 580, not 1,160; there is no minimum. A necessary extra path or larger total requires a scope amendment before editing.

## Acceptance and validation plan

- End before today or exactly today: 404. End after today or NULL: 200. Future start unchanged.
- Ended readable attachment plus valid unreadable attachment: 404. At least one valid readable attachment: 200; historic facts retain existing scope.
- Branch timezone override and business fallback; fixed instant across local midnight and differing DB/session timezone; injected clock determines eligibility.
- Cursor from the previous day cannot recover eligibility ended today.
- End/delete last eligible attachment between check and final SQL: null/404 without page or last_taken disclosure. Unrelated employee mutation retains results.
- Missing history eligibility data fails closed. Existing soft-delete race, feature flag, permissions, tenant/business isolation remain covered.
- Existing open-list, inbox and own callers keep their outcomes, including previously visible ended attachments wherever those callers currently permit them.
- One final statement still supplies history page and last_taken; no new transaction or locking.

Preflight completed: mandatory repository readings completed through bounded reads after replacing truncated output; canonical PP-138 and its evaluation ledger read. HEAD and live remote main both equal the inspected baseline. Tracked source is clean; only this planning document is untracked. SHA256 and baseline blob receipts for all eight paths were recorded for the manager (new eligibility spec absent). Current delivery worktrees have no allowlist changes; live open-PR query is empty.

After authorized implementation and DB resource handoff: run focused eligibility/race/consistency suites and existing leave-history-access/http/parity, leave-open-list, leave-queries, personal-leave-history, current-branch-links and leave-rls regressions. Run applicable API typecheck/lint, documentation, boundary and module-map checks; exact-head CI/reviews remain separate merge gates. No tests have been run in this planning phase, so regression preservation is a design claim awaiting execution evidence.

## Manager decision

Manager approved this design and the eight-file allowlist explicitly. The local manager execution handoff is outside this PR and remains unpublished. Successful preflight lifts SOURCE BLOCKED without another approval. Initial source/test author: MiniMax M3.1-Flash thinking through T3 MiniMax Code; the orchestrator reviews the diff and runs scoped gates. Astra medium supplied advice only. PP-131.2 allows three review/fix rounds; exact-head/base CI, five reviews, backup/restore and merge order remain independent gates.

Local resource owner/current turn: #901, private Postgres lane `issue901`, candidate port 55490 after availability verification. Private Redis only if the harness requires it, candidate 56390 after verification. Follow #902 provenance and ownership lifecycle: fresh local template-derived credentials, exclusive creation, task/worktree labels, loopback bindings, no borrowed services/secrets or shared fallback. Frozen install, dependency builds and scoped tests/checks are authorized; heavy/full suites stay on CI. Notify the manager at phase completion, blocker, resource release and readiness.

## Validation in progress (2026-11-08)

Fresh independent Astra/high read-only review found no confirmed P0–P3 defects. Eight file hashes matched before/after; snapshot digest `66ce314fcfbe1a63f5825cf2737edf718c4f30597caacf0ea2d1358d87678633`. This receipt is the only subsequent change. Review ran no tests. Explicit partial-day/action-metadata tests remain coverage limitations without a demonstrated defect. CI/performance and five exact-head external reviews remain required.

Initial MiniMax delivery reviewed; missing/empty eligibility guards corrected directly. Round 1/3 remains open. The redundant fixture correction task `3461049b-8bd8-47df-83b9-ac7bb8dc2002` was cancelled through `task_cancel`; terminal receipt: interrupted, activeRunId null, completed 2026-11-08T03:21:03.668Z. No replacement. Fixture correction is direct: fresh attachment rows per scenario, including NULL/future-start transitions; no close-only trigger bypass.

Executed successfully: `pnpm install --frozen-lockfile`; `pnpm --filter '@pospay/api^...' build`; `pnpm --filter @pospay/api typecheck`; `pnpm lint:docs` (0 errors, 29 existing warnings); `pnpm module-map:check`. API lint first failed only an unused test variable; fixed, then scoped ESLint on the eligibility file passed. Formatting applied only to allowlisted files.

First focused Vitest run (eligibility/race/consistency): exit 1, 9 passed and 11 failed in eligibility setup (`employee branch history is close-only`); Redis connection refused at private port 56390. After correcting the fixture and provisioning authorized private Redis, rerun passed: 3 files, 20 tests, exit 0, 94.56 seconds. Regression run passed: 8 files, 75 tests, exit 0, 142.19 seconds. Both used `pnpm --filter @pospay/api exec vitest run` with explicit spec paths under `src/modules/staff/__tests__/`; regression names: leave-history-access, leave-history-http, leave-history-parity, leave-open-list, leave-queries, personal-leave-history, leave-rls, current-branch-links. Heavy performance/EXPLAIN ANALYZE suite stays in CI. Independent review/CI remain pending.

Resource provenance: root `.env` created exclusively from this checkout's tracked template, fresh random local credentials, never printed; no prior env files existed. Postgres container `4e0efa918b3cf14dfaa1d0301ede896835c32474b756eb591db33dc9deb60297` used lane issue901 at loopback 55490. Redis `7b263eb71fb89d8d5ad16533a9714e1ae1721f9c2883fbdb00d893f61adf070e` used loopback 56390, same lane/worktree labels, Redis 7 dev topology, PONG verified. Tests explicitly received private PG overrides and private REDIS_URL. After all commands exited, Redis client/ownership checks passed and its --rm lifecycle removed it; lane helper down removed owned Postgres/data/override. Lane container inventory empty. Resource turn released directly to #833 with manager receipt; local credentials retained privately, not shared.
