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
- The personal/reception slot retains confirmed session data during transient probe failure only until
  the known expires_at; expiry, explicit authentication refusal, offline and identity replacement clear private state.

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
  8.5.3 native source. iOS `HttpRequestHandler.swift` lines 160-167 parses
  `application/json` before the `.text` branch; Android `HttpRequestHandler.java`
  lines 240-265 also parses JSON content type before response-type conversion.
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


## Authorized limited correction round 4

The manager relayed Waleed's verbatim approval `approve both`; the complete
scope and the follow-up statement are recorded in this slice's owner audit.
This exception covers only r4490631177 and r4490631191. No additional round
or merge-gate waiver is inferred.

Read and write authorization refusals now share a persistent refusal latch.
Automatic history reads stop after either refusal. Only a successful explicit
retry releases that latch. The panel independently checks read and write
refusals and gives the refusal priority over an older non-refusal write error.
Two visible regressions cover 30 seconds without automatic recovery followed
by successful explicit retry, and write409 followed by read403 hiding the form
and history with the permission error displayed. The first affected run passed
32 tests in three files. The final recheck after the small read-function extraction
also passed all 32 tests. Global typecheck, lint, lint:docs and module-map:check
passed; git diff --check passed. Parent clean-code-guard, test-guard and docs-guard
passes verified the bounded refusal policy, visible regressions and approval audit.
No push before all four panel receipts on 0f6d2235.


Panel receipt 5797845732 on 0f6d223544d458bf0bb8c949212ff88e2dd315d1
confirms all four bots completed. Earlier checks mistakenly inspected only the
first API page: its empty review bodies were human replies, not panel receipts.
Reading reviews with per_page=100 corrected that error. The panel's error-priority
finding r4490669773 duplicates the authorized correction. Its separate transient
session-probe draft-loss finding r4490669774 is confirmed by the session hooks,
but falls outside this limited fourth-round approval. It remains unresolved in
[#886](https://github.com/lolotam/PayPos.systems/issues/886); creating that issue
does not waive the known-defect merge gate. No session-hook changes are included.

## Authorized correction round 5

Waleed approved exactly one fifth round, after the original 3/3 and the limited
fourth-round exception. The original manager card, both options and his verbatim
answer are recorded in the slice owner audit. The Arabic audit was restored using
UTF-8 directly rather than passing Arabic through the Windows Python stdin pipe.
The fourth-round English approval and follow-up remain intact; no decision is invented.

Rebased the five existing commits onto main
`572a10627d006b50909cd254af51e167de2c7e69`. Only owner-questions.ar.md conflicted:
kept main's pending rating-claims record and this slice's approval record.
Range-diff shows the first four patches identical and only the fifth document
context changed. A direct comparison of committed POS source before/after rebase
was empty. Backup branch `backup/57b2b-before-round5-3e885e7e` is retained.

The approved fixes are limited to:

- #886: retain the confirmed personal/reception session through a transient
  503/network probe error. Both probe adapters classify explicit 401/403/404
  as no session, while outages throw. Null/revocation, offline and identity-change
  paths still clear private state. Visible integration tests cover both modes,
  503/network failure, successful recovery and subsequent 401 clearing.
- 401 recovery: keep a session-scoped Retry visible with no private content.
  Explicit retry verifies the same user/company/business and then a fresh allowed
  branch/history read before restoring the screen. Repeated refusal and a different
  session identity do not restore old data; requests are cancelled/ignored on unmount.
- Timezone is display metadata, excluded from the identity key; every other context
  field stays in the key. A visible reception test confirms late timezone cannot
  remount the screen, restart reads or clear a refusal latch without Retry.
- Form changes clear only the root validation message, preserving field errors.
  A visible invalid-period/correction test checks the stale error disappears before
  any POST is sent.
- Restored the approval audit and retained the previous round history without reset.

Final affected regression run: 12 POS files, 69 tests passed. Includes the prior
polling/error-priority/refusal cases, session hook offline/replacement/revocation,
native personal transport, attendance and push call regressions. One initial
fixture failed because the staff singleton captured a previous fetch closure;
using a stable network-boundary mock fixed isolation without weakening assertions.
A pre-existing hook test now models revoked authentication as the adapter's null
outcome rather than a generic exception; a real HTTP-boundary test independently
checks 401/403/404 versus 503. No real-device smoke is claimed.

Global typecheck, lint, lint:docs and module-map:check all passed. Prettier
checks passed for all changed TS/TSX files; git diff --check passed. The UTF-8
owner audit was verified against git-show bytes before publication. Parent clean-code-guard/test-guard/
docs-guard passes checked shared-session refusal semantics, bounded components,
visible outcomes, and audit/source correspondence. No API/server/native config,
migration or workflow change is included. This round repairs the merge conflict
that prevented pull_request workflows from being created; exact-head CI/mobile
and external reviews remain required after publication. No automatic merge.
## Authorized unified correction round 6

The original 3/3, fourth and fifth exceptions remain in the record. The owner first
approved the historical two-character documentation card, then approved the unified
sixth-round card that supersedes it. Both original questions/options/answers are
preserved as UTF-8 in owner-questions.ar.md (manager activity29259/29281 and
answers29292/29293). No separate documentation push or counter reset occurred.

This round contains only the four approved P2 corrections and the two line ranges:

- Branch discovery now retains its own 403/404 refusal latch. Automatic reads remain
  disabled after refusal, even across focus/rerender. Only successful explicit Retry
  clears it. The refusal UI takes precedence over the removed query's pending state.
- Cancellation applies the confirmed returned record to matching cached pages before
  refreshing. A transient503 cannot restore the old PENDING row or cancellation action.
  This is server-confirmed data, not an optimistic cancellation or API-order change.
- Both personal and reception session hooks share a local deadline check for the
  server-provided expires_at. It hides sessions and clears query state at that known
  deadline despite failed probes. Focus/visibilitychange recheck wall time on resume;
  the server's expiry rule is unchanged. Missing/malformed deadlines expose no session.
  Old hook fixtures now use a future ISO deadline instead of an expired/invalid string.
- After same-identity recovery, a removed selected branch is dropped; the freshly
  authorized branch selector can offer an alternative without restoring removed-branch
  history. Existing refusal behavior remains for a still-selected but refused branch.
- Native-source line references now read160-167 and240-265, without changing rationale.

Final visible regression run:14 POS files /79 tests passed. New cases cover branch
403/404 with real visibility/focus events plus rerender, cancellation success with
refresh503, six personal/reception expiry cases (timer/visibility/focus with503/network
failures), and recovery to a permitted alternative for the same identity. Existing
history latching,401/different-identity recovery, offline/replacement/revocation,
transport, attendance and push regressions also pass. An initial run caught loading
precedence hiding Retry after cache eviction; the same assertions pass after fixing it.
The alternative-branch fixture now supplies matching request_branch_ids; no assertion
was removed to accommodate a mismatch in synthetic creation authority.

No API, server expiry, migrations, native configuration or workflow changes. The
single UI retry component extraction preserves the60-line function limit. Parent
clean-code-guard/test-guard/docs-guard passes checked the deadline/cache semantics,
server-confirmed cancellation, visible outcomes and verbatim decision source.
Final local gates, git-show UTF-8 verification and publication identity follow below.

Global typecheck, lint, lint:docs and module-map:check passed (exit0). Prettier and git diff --check passed. The historical two-character card and superseding unified card were checked against git-show UTF-8 bytes before and after commit. No exact-head CI/review pass is claimed before publication; those gates must run on the resulting SHA.

## Authorized unified correction round 7

Before implementation, the owner audit recorded both cards verbatim as UTF-8:
the historical two-test card and the superseding unified seventh-round card.
All original3/3 and fourth/fifth/sixth/seventh exceptions remain without reset.
The approval-only commit stayed local until the one consolidated publication.

Rebased onto main da775eb5e5b62adcb48b26d1e55fdba1a2ce671f. Owner audit
conflicts during replay of rounds4/5 were resolved by retaining main's #888
record and this slice's records. Range-diff covers all eight pre-implementation
commits: six patches identical; two differ only in owner-audit context. A direct
comparison of committed POS source before/after rebase was empty. Both backup
branches remain; no worktree or branch cleanup occurred.

The runtime trace confirmed that openapi-fetch0.17.0 returns decoded JSON and
personalCalls.session/probeStaffSession forward it without session-schema parsing.
Generated paths supply static types only. Current server writers use toISOString,
but this does not validate a malformed response before the client hook. The helper
now calls the existing exported contracts timestamp.safeParse before Date.parse.
That schema validates actual ISO calendar dates and requires a timezone, accepting
the contract's UTC/explicit-offset formats without a new schema or API change.

Fixtures are corrected in exactly the five approved existing test files:
own-leave-entry, leave-session-probes, sign-out-push, personal-screen and
reception-body. Date is frozen at2026-10-04T10:00Z and restored after each test.
The personal-screen test retains its existing interval fakes and adds Date only;
other new clock fakes target Date alone. The reception placeholder is replaced
with a real future ISO deadline. All existing assertions remain unchanged; the
original deliberate expiry tests keep their clock transitions.

A new visible helper regression file tests date-only, offset-less, impossible
February31/non-leap February29, invalid month and empty values; valid UTC,
fractional seconds, positive/negative offsets and a real leap
day; and the exact/past deadline boundary. Invalid inputs hide private content
and clear session state; valid future contract timestamps preserve it.

The preceding failed CI job127946224402 had14 failures in three files, reproduced
locally without changes. They failed at the initial fixture preconditions before
push/logout/camera behavior. The previous79-test selection omitted those files;
this round runs the entire POS test suite, not just the selected slice files.

No server expiry, API, migrations, native configuration or workflow change.
Parent clean-code-guard/test-guard/docs-guard review verified the public contract
validator, visible assertions, clock restoration, and verbatim audit/source.
Final suite/gate results and git-show UTF-8 verification are recorded below before
publication. No exact-head CI/review pass or merge waiver is inferred locally.

The first new positive-control run assumed minute-only precision was accepted.
Direct inspection of the installed Zod4.6.5 timestamp validator disproved that:
2099-10-04T12:00Z is rejected by the actual contract although Date.parse accepts
it. The case is now correctly categorized among contract refusals, without
broadening the production schema or weakening any existing assertion.

Final proof: the complete POS suite passed616/616 tests in99 files with
`pnpm --filter @pospay/pos exec vitest run --pool=threads --maxWorkers=2`.
File isolation remained enabled. The corrected helper file also passed14/14
independently. The original602 tests, including all14 previous CI failures,
passed; all existing assertions in the five fixture files were preserved.
Global typecheck/lint/lint:docs/module-map:check passed; Prettier/diff checks passed.
Parent guard review found no further issue in the authorized patch. UTF-8 cards
were verified against git-show bytes before/after commit; exact-head remote gates
are still required after this single consolidated publication.
## Limited eighth correction round — local receipt

Owner approval was recorded verbatim before implementation in local commit
`58953ee8`; the original 3/3 and exceptions four through eight remain intact.
The question, both choices and answer were read back from `git show` as UTF-8.
No API, server expiry, native configuration, migration, workflow or cancel404
policy changed.

- Creation cards now use issued/completed network-read generations and a React
  notification. Local cancellation cache writes cannot clear the card, and a GET
  started before creation cannot clear it when it finishes later. A successful
  later GET can clear it even when structural sharing preserves identical data.
- Session probing/validation/composition moved from `my-leave/api/` to
  `app/recover-leave-session.ts`, injected through `RecoverLeaveSession`.
  The actual personal/reception contract is parsed at runtime; invalid or elapsed
  deadlines and foreign account scope are refused. An earlier outer probe is
  cancelled before publishing a verified session to its exact query key.
  Changed expiry/employee causes the outer flow to remount from the fresh
  context instead of unlocking the old one. Its existing deadline hook enforces
  the newly known deadline during later probe failures and background return.
- Branch Retry is disabled with visible loading feedback while its read runs.
  The cancellation cache assertion now checks `leave-0` specifically for
  `CANCELLED` and `can_cancel: false`, preserving the preceding assertions.
- The existing creation-card test moved unchanged into
  `leave-creation-card.spec.tsx`; all previous assertions remain. Direct screen
  tests inject the same app recovery composition. The two recovery fixtures now
  return actual contract-shaped session objects for runtime validation.

Independent internal review: Codex Astra high, read-only, completed. It found
an in-scope P2 during review: a ref-only completion counter did not notify the UI
for an identical successful GET. The React notification and history-only test
filter fix that case; the reviewer re-read the final version and reported no
confirmed open P0/P1/P2/P3 in this round's delta. The review ran diff-check and a
TanStack InfiniteQueryObserver experiment; it did not run the POS suite. A
separate deferred recovery then close/offline integration test was not added;
abort checks before/after cancellation were reviewed, not claimed as that test.
Parent clean-code-guard/test-guard/docs-guard passes checked the final delta,
visible assertions, production boundaries and the exact approval record.

Remote review prerequisite: using the published MergePilot run-detail Retry
button after verifying PR head `6d7e7b65` and no active run, the failed Waleed run
`07d4e75a-64ee-4067-851b-c989b2f62a4c` was retried once. The official mechanism
created a panel; the other three skipped because there were no new changes,
retaining their original complete receipts. Waleed retry
`e5885359-3f92-4dc5-87f4-bc946a141e03` completed as review `5803282769` on that
head, using `openai:gpt-5.6-sol`. No model/configuration/DB/queue change was made.
Security review `5802625713` completed via its configured OpenAI fallback after
MiniMax timeout300s; no provider setting was changed here.

New Waleed P2 `r4494761636` (cancellation absent on the creation card) is outside
the eighth card and was raised to the manager before any implementation. It
remains open; no fix, waiver, extra round or merge authority is inferred.
CodeRabbit `r4494238075` was rejected and resolved with the manager's approval:
`NOT_FOUND` also masks lost authority/eligibility at the transaction boundary,
not only a missing cancellation target. Reply `4494356681` and resolved status
were read back; the contract does not distinguish those causes.

The first expanded POS run passed627/627 in100 files. After final test extraction
and the additional outer-probe race test, a fresh complete run is required below.
Focused final recovery/card runs passed12/12, including the history-only refetch.
Global typecheck/lint/lint:docs/module-map:check, changed-file Prettier and
`git diff --check` passed. No exact-head CI or review completion is inferred from
these local results; a single publication remains subject to the manager's
handling of the newly raised out-of-scope finding.

Final eighth-round proof: POS suite passed628/628 in101 files with the same
threads/maxWorkers2 command (244.62s); isolation remained enabled. The101-file
run includes all prior tests plus the extracted card tests and new recovery
composition/race cases. Global typecheck/lint/docs/module-map and changed-source
Prettier passed; both changed docs also passed Prettier. AST comparison across
the edited existing test files and the extracted card file preserved all93
previous assertion chains (123 current, no missing chain). Historical audit
content is an unchanged prefix, with the eighth approval appended. No push has
been made pending the manager's disposition of r4494761636.

## Eighth-round final disposition — creation-card cancellation deferred

The final owner answer is recorded verbatim in the audit:
«أؤجل الزر لمتابعة موثقة (الموصى به)». It supersedes only the earlier
creation-card expansion approval, which remains historical. The original3/3
and exceptions four through eight remain; this is not a ninth round or a reset.

Follow-up [#890](https://github.com/lolotam/PayPos.systems/issues/890) records the
missing server authority source and explicit deferral of the creation-card
cancellation button. POST returns `LeaveRequest`, without `can_cancel`;
`LeaveListItem` in GET history alone adds that field. The contract, OpenAPI,
controller, use case and transaction return path were checked. Inferring a grant
from `PENDING` or successful creation, casting a flag into existence, or unbounded
pagination is not an implementation of the approved permission policy.

The attempted UI addition exposed TypeScript TS2339 for `request.can_cancel`.
Its synthetic POST fixture therefore did not prove the real API behavior. That
uncommitted draft was preserved outside the repository and removed with targeted
patches; no reset was used. There is no creation-card cancellation source change.
The POS tree is byte-for-byte the same git tree as checkpoint
`609cd7b00ff410ea643235ff1930c921528837ff`, whose earlier receipt and review remain
preserved. No review of a newly implemented button is claimed.

Issue890 acceptance criteria require a documented server authority source with
live permission/eligibility checks, a bounded read or compatible response, and
visible oldest-first/new-row-missing, can_cancel=false, id/revision, pending
button, confirmed-cancel/refresh503 and401/403/404 refusal tests. Current history
order and API remain unchanged. The button is deferred, not fixed in PR882.

Waleed thread `r4494761636` received decision/evidence reply `4495174126`, linked
to issue890, then was resolved. Both reply and `isResolved=true` were read back.
All other eighth-round fixes remain in scope. Their five review threads will
receive the published fix commit before resolution/read-back. No exact-head
remote CI/review pass, Codex request or merge waiver is inferred.

The final document-only disposition does not alter the tested POS source:
628/628 tests in101 files at checkpoint remain the applicable full POS proof.
Typecheck/lint/docs/module-map/Prettier and an independent read-only review of
the final audit/disposition are rechecked before publication; their results are
recorded below. The published head and current main are checked again before
the one explicit branch push. CI/mobile and all panel receipts on the new head
remain required; only the manager coordinates Codex after panel findings settle.

Final independent review after the disposition: Codex Astra high completed a
fresh read-only review of all19 paths in the final round-eight delta, the actual
contracts/session hooks and governing spec/ADRs. No confirmed open P0/P1/P2/P3
was found in that reviewed delta. It independently verified identical POS tree
hash742bdae601852b97cb6ff35e6d324f5e9d0124b5 at HEAD and609cd7b0, no source
changes outside docs and no untracked POS files. It ran diff-check; it did not
rerun suites or independently check remote issue/thread state. The parent read
back issue890 OPEN and the deferral reply/resolution. Fresh global typecheck,
lint, lint:docs, module-map:check and changed-doc Prettier passed after the
disposition. The628/628 checkpoint suite is identified as applicable identical-
source proof, not a newly run suite or a remote-head gate. The audit's full final
question/options/answer and historical expansion were verified with git-show.


## Ninth correction round - authorized 2026-11-06

This section supersedes the eighth-round correctness claims only for the two
newly confirmed defects. Original 3/3 and exceptions four through nine remain
recorded; there is no reset. The full ninth approval was already committed in
`0692d687860c88b22d435e5233ec000221f445be` before implementation. The verified
worktree is `F:/Dev/Worktrees/PosPay/57b-2b-my-leave`, branch
`feat/p1-060-57b-2b-my-leave`. Published/source baseline:
`101d23a304f06944e82621ab99e30a4db8319b8f`. Implementation remains uncommitted.

### Findings and implementation

- P1 r4495305830/r4495315404: authoritative null, foreign identity, malformed or
  elapsed recovery now writes null to the exact outer session query, allowing
  the actual session hooks to hide the old identity and clear other private
  caches. Network/503 throws before that mutation. The existing keys
  `['personal-session', epoch]` and `['staff-session', epoch]` were correct.
- Recovery captures the actual query object and `state.dataUpdateCount` before
  probing. Abort, query replacement/removal, or a later data revision fences
  mutations and subsequent reads. Checks bracket the probe, cancellation and
  leave reads; cancellation uses `revert: false`. Installed query-core 5.104.0
  source was inspected: manual setData increments dataUpdateCount and updates
  revertState; cancellation with revert restores that state. Both hook-owned
  private-cache cleanup continuations recheck their owning query revision after
  cancellation before removing data.
- P2 r4495305840/r4495315412: device boot now carries the authenticated device id
  into the displayed ready context. Reception compares both branch and device
  before composing leave, preserves the actual staff branch instead of
  overwriting it, and uses the existing retry/boot/probe flow on mismatch.
  The composition remounts for the new branch/device and obtains its timezone
  afresh. A retained retry fence prevents repeated automatic boots for the same
  rejected displayed binding. Missing device identity fails closed for leave.
  Recovery also compares branch/device before any leave probe.
- This is a client pairing/context defect. StaffSessionContext is strict and
  contains device_id; the server enforces device binding. No server bypass or
  old-cookie/new-device acceptance is claimed. No backend API/contract, native, server deadline,
  migration, workflow, deployment or credential changes were made.
- CodeRabbit r4495343852: reception tests now inspect the exact outer staff key
  after a shorter deadline recovery, hold an earlier outer probe across recovery,
  fail subsequent probes, and return via visibility/focus at the new deadline.

### Assertion correction and test scope

The two expectations in `app/leave-recovery-context.spec.tsx` that asserted
`toEqual(session)` after malformed/elapsed or foreign rejection were incorrect.
They now assert outer null and visible hidden identity. Their previous
Retry-enabled wait now waits for the hidden identity because the rejected
session unmounts the recovery button. Existing form-hidden and leave-cache
assertions remain. Existing standalone leave tests seed the real outer query
in their harness and supply the reception device id; their previous assertions
remain. Device boot/probe expectations add deviceId alongside the existing
branch assertion.

New visible hook tests cover both session types, other-private cache clearing,
late authoritative failure, network failure and success with/without abort,
abort while cancellation is pending, closing, local logout invalidation and
offline epoch removal. Transport is stubbed at fetch; the QueryClient, schemas,
recovery helper and React session hooks are real. The cancellation-race test
holds cancelQueries after invoking its real implementation. Closing is modeled
by the recovery AbortController; logout exercises the hook's changed callback,
not the remote sign-out endpoint. BroadcastChannel is disabled in that harness
so logout cannot invalidate unrelated Vitest worker sessions.

The reception pairing test runs DeviceBody, useDeviceSession, boot/probe,
ReceptionBody, StaffLoginScreen and the leave screen. Only credential storage
and HTTP boundaries are stubbed. Branch-only/device-only changes are introduced
through explicit recovery, with boot held: no new leave read/write occurs while
binding is stale, then the new paired branch and its New York clock are visible.
A matching positive control opens leave without another boot. Existing
`app/leave-session-probes.spec.tsx` 503/network draft controls remain unchanged.
These are UI/composition proofs, not a live two-tab browser or real API/DB test.
The external diagnosis scripts were not used as replacements for these tests.

### Verification history and limitations

Initial focused existing app files passed 13/13. New fence tests passed 8/8;
reception recovery/pairing tests passed 10/10 before the additional logout cases.
The initial full suite found four failures: standalone recovery harnesses lacked
an outer query/device context, and probe expected only branchId. Those harnesses
and the device expectation were corrected without removing their assertions.
The next full suite passed 644/644 in 104 files (112.36s); after logout/offline
coverage it passed 646/646 in 104 files (107.26s), before final harness isolation.

Initial parallel global typecheck/lint builds collided on the same POS dist
outputs: EBUSY copying icon.svg and workbox manifest injection failure. Sequential
runs passed afterward. Lint also caught two functions exceeding 60 lines; the
recovery fence and staff cleanup effect were extracted locally. Typecheck caught
unsupported Testing Library ByRoleOptions.exact in the new test; it was removed.
A combined focused run exposed cross-worker BroadcastChannel logout interference,
which was isolated at that boundary; a wait for the initial leave read to settle
also makes refusal setup explicit. No failure is represented as a pass.

Final command receipts follow below. All remote CI/reviews, independent Astra
review, publication and merge remain the parent's responsibility. No remote
check/review result is claimed. Issue #890 remains deferred: no creation-card
cancel button and no inferred can_cancel were implemented.

### Final local receipts

- `pnpm --filter @pospay/pos exec vitest run --pool=threads --maxWorkers=2`: PASS, 646/646 tests in 104 files, 108.88s, after the final harness isolation. Baseline was 628/628 in 101 files; 18 tests were added in 3 files.

- Focused visible suite: `pnpm --filter @pospay/pos exec vitest run src/app/leave-recovery-context.spec.tsx src/app/leave-session-probes.spec.tsx src/app/leave-recovery-fence.spec.tsx src/app/reception-leave-binding.spec.tsx src/app/reception-leave-recovery.spec.tsx --pool=threads --maxWorkers=2`: PASS, 31/31 in 5 files, 10.17s.
- `pnpm typecheck`: PASS, 32/32 Turbo tasks.
- `pnpm lint`: PASS, 33/33 Turbo tasks, including boundaries; existing warnings remain.
- `pnpm lint:docs`: PASS, 0 errors, 29 existing warnings.
- `pnpm module-map:check`: PASS, module map: ok.
- Changed-file `pnpm exec prettier --check` and `git diff --check`: PASS; formatting includes new untracked tests.
- `clean-code-guard`, `test-guard`, `docs-guard`: implementation self-review completed against the changed production code, tests and this receipt. No additional in-scope finding remains from that self-review. This is not the independent Astra review.
- The existing validation history is an unchanged text prefix; the owner audit is unchanged from HEAD. UTF-8 was explicit in file reads/writes. No commit, push, PR comment, review trigger, merge, deploy or delegated work was performed.

### Changed-file manifest

- `apps/pos/src/app/device-body.tsx`
- `apps/pos/src/app/leave-recovery-context.spec.tsx`
- `apps/pos/src/app/reception-body.tsx`
- `apps/pos/src/app/recover-leave-session.ts`
- `apps/pos/src/device/api/boot-device.spec.ts`
- `apps/pos/src/device/api/boot-device.ts`
- `apps/pos/src/device/api/device-calls.ts`
- `apps/pos/src/device/api/probe.spec.ts`
- `apps/pos/src/device/api/screen-state.ts`
- `apps/pos/src/my-leave/model/context.ts`
- `apps/pos/src/my-leave/ui/leave-recovery.spec.tsx`
- `apps/pos/src/my-leave/ui/leave-round6.spec.tsx`
- `apps/pos/src/personal-staff/api/use-personal-session.ts`
- `apps/pos/src/staff-login/api/use-staff-login.ts`
- `docs/specs/060-ratings-and-staff-app/57b-2b-validation.md`
- `apps/pos/src/app/leave-recovery-fence.spec.tsx`
- `apps/pos/src/app/reception-leave-binding.spec.tsx`
- `apps/pos/src/app/reception-leave-recovery.spec.tsx`


### Ninth-round internal review corrections (before publication)

The first independent Astra high review found two in-scope defects: a stale
displayed context could capture a newer cache revision before recovery began,
and binding retry fences were not rearmed after a trusted matching session.
The recovery fence now checks the initial cached user/company/business/expiry
and mode-specific employee or branch/device against the requesting context
before probing. Existing query identity/revision/abort checks remain. Both
reception retry fences reset only after an actual non-null matching session;
loading/null does not rearm an unresolved mismatch. New visible regressions
cover personal/reception cache-B versus context-A at retry start and two
mismatch/boot/match cycles without a repeated boot during either mismatch.
Focused two-file run passed14/14 and POS lint passed. The implementer's646/646
receipt precedes these changes; fresh full-suite/gate/review results remain
required and are not inferred from that earlier receipt.


### Parent verification after internal fixes

The parent full run initially failed2/649 tests in the standalone leave-recovery
harness: after foreign recovery rejection the outer query was correctly null,
but the isolated screen attempted recovery again without an outer-session
verification. The harness now asserts null first, then explicitly seeds the
verified outer context before its existing successful-retry assertions. No
production guard was weakened and no previous assertion was removed. The file
passed4/4 afterward. A fresh complete POS run passed649/649 in104 files
(135.43s), with file isolation enabled. This supersedes the earlier failed
parent run and the implementer's pre-internal-fix646 result for this source.
The three added parent regressions cover stale displayed context at retry start
for both modes, and repeat mismatch/boot/match rearming without an unresolved
mismatch loop. Independent re-review remains pending; no remote gate or merge
authority is inferred.


### Repeated-null cleanup correction

The second independent review found an in-scope P2: a second null publication
during private-query cancellation advanced dataUpdateCount, causing cleanup to
skip without another effect notification. Cleanup now requires the same query
object/epoch and CURRENT null data, rather than an unchanged null revision.
A newer live session still blocks removal; another authoritative null allows
completion. New visible tests for both hooks hold real cancellation, publish
null again or a live B session, then verify cleanup or preservation respectively.
The focused fence file passed12/12. The649 suite precedes this correction; final
full suite/gates and a fresh independent recheck remain required.


Parent final verification after repeated-null correction: complete POS suite
passed651/651 in104files (156.49s), isolation enabled, using the same
vitest threads/maxWorkers2 command. Global typecheck/lint/lint:docs and
module-map:check passed after that correction. These results supersede the
pre-correction649 receipt for the current source. Independent re-review is
still pending; no publication, remote-gate pass or merge authority is inferred.


### Final independent ninth-round review

Fresh Codex Astra high re-review completed after all internal corrections,
including repeated-null cleanup. It reviewed all18 changed paths and the
approval audit against101d23a3, reporting no confirmed openP0/P1/P2/P3 in
the final delta. It checked source and relevant integration tests, without
running suites itself. Parent651/651 in104files and local gates are separate
command receipts, not reviewer-run tests. The initial P1/P2 and subsequent P2
review results remain historical findings fixed before publication, not passed
gates. Changed-file Prettier and diff-check passed. Current main was freshly
verified as da775eb5 and the published head as101d23a3 before preparing the
one explicit branch push. No backend API, server expiry, native configuration,
migration or workflow changed. #890 remains explicitly deferred. Remote
CI/mobile and four panel receipts on the resulting head remain required before
manager-coordinated Codex; no merge/deploy authority is inferred.


## Tenth correction - uncommitted implementation receipt

Worktree verified first: F:/Dev/Worktrees/PosPay/57b-2b-my-leave,
branch feat/p1-060-57b-2b-my-leave, local HEAD
8fffda483b019d7acf8c840780db8b44ae9c7bae (audit only), published baseline
67ca782d6124c9df3f2a8f842ed0b9396c4f2195. The latest tenth card was read
verbatim before implementation. This is the same tenth batch; 3/3 and
exceptions 4-10 remain historical and binding, without reset or an eleventh.
No commits, pushes, GitHub comments, review triggers, merge or deploy performed.

Scope: r4496737996 now has one useStaffLogin owner in ReceptionBody. The new
StaffLoginPanel receives that exact state; StaffLoginScreen retains its
self-owned wrapper for standalone consumers. No epoch synchronization heuristic,
conditional hook, business-area cross import, or recovery-fence change was added.
The demonstrated original issue hid leave; it did not demonstrate data exposure.
r4496750305 now resets finish per nested iteration, establishes a started promise
before clicking, and receives/releases that attempt's resolver from the promise.
All existing correct assertions remain.

Changed manifest (relative to this audit HEAD):
- apps/pos/src/staff-login/ui/staff-login-panel.tsx (new panel)
- apps/pos/src/staff-login/ui/staff-login-screen.tsx (standalone wrapper)
- apps/pos/src/app/reception-body.tsx (shared ownership)
- apps/pos/src/app/reception-leave-binding.spec.tsx (actual PIN/OTP and switching)
- apps/pos/src/app/leave-recovery-fence.spec.tsx (per-attempt synchronization)
- apps/pos/src/app/reception-body.spec.tsx
- apps/pos/src/app/device-body.spec.tsx
- apps/pos/src/app/device-screen.spec.tsx (the last three update the existing
  component mock target to the extracted panel; assertions are preserved)
- docs/specs/060-ratings-and-staff-app/57b-2b-validation.md (this append)

The eight new UI variants use actual form paths, real hooks and network/storage
boundaries: PIN/OTP, operator replacement, branch-only/device-only mismatch,
BroadcastChannel available/unavailable, immediate held boot (1000ms wait ceiling,
no 15-second timer advance), hidden leave and unchanged read/write counts until
pairing matches, then the new branch timezone. Existing repeat-boot/match,
503/network, draft and idempotency regressions remain in the full suite.
The BC double has a test-local registry, excludes only the sending channel and
queues messages for other same-name channels including those in the same window.
It does not use Node's cross-worker BroadcastChannel. Limits: jsdom only, no real
multi-tab/browser transport timing, no server/API, DB, native or Playwright run.

Command history (logs under F:/Dev/Temp/882-r10-*):
- Focused binding + fence run initially failed eight new cases because the test
  used staffLogin.switch instead of staffLogin.switchOperator. Corrected test key.
- Focused five-file run: pnpm --filter @pospay/pos exec vitest run
  src/app/reception-leave-binding.spec.tsx src/app/leave-recovery-fence.spec.tsx
  src/app/reception-leave-recovery.spec.tsx src/app/reception-body.spec.tsx
  src/staff-login/ui/staff-login-screen.spec.tsx --pool=threads --maxWorkers=2:
  35/35 passed (13.48s).
- External-only Vite transform 882-r10-mutant.config.cjs aborts the controller
  before the probe on later nested iterations. Running the fence file with
  -t 'late failure and success' failed BOTH selected tests at the started promise
  (5000ms timeout), as intended. The ten unselected tests were excluded solely
  by the CLI name filter; no source skip/deletion was added. This is mutation
  rejection, NOT a product pass. Earlier read-only diagnostic evidence showed
  the former test passing at probeStarts 1/6; no diagnostic code was copied into
  production tests.
- First complete POS command: pnpm --filter @pospay/pos exec vitest run
  --pool=threads --maxWorkers=2: 652 passed, 7 failed, 104 files, 198.55s.
  Four failures were stale component mock targets; fixed without changing asserts.
- Targeted recheck of device-body/device-screen/leave-recovery/leave-round6:
  20 passed, 3 failed. Both device files passed. Remaining reproducible failures:
  leave-recovery: personal/reception 'recovers ... after401 only on successful
  explicit verification' cannot find From date; leave-round6: 'recovers the same
  identity to an allowed alternative when the old branch was removed' cannot
  find Branch. These source files and recover-leave-session.ts are unchanged.
  Reported before any expansion; no assertion or freshness gate was weakened.
- First pnpm typecheck failed TS2349 for TypeScript narrowing of the callback
  assigned inside fetch. The started promise now returns its own release callback;
  pnpm typecheck rerun passed.
- First pnpm lint failed max-lines-per-function in the enlarged fixture beforeEach.
  Extracted bindingTransport; pnpm lint rerun passed (existing warnings remain).
- pnpm lint:docs and pnpm module-map:check passed. Runs are sequential with
  typecheck/lint; no simultaneous POS build output writers were started.

Explicit deferrals: r4496735683 polling remains NOT FIXED, tracked by
https://github.com/lolotam/PayPos.systems/issues/891. A matching poll can advance
dataUpdateCount and require a second Retry while remaining fail-closed. All
freshness/revision/query/epoch/abort/null/identity/expiry fences are unchanged;
#891 requires a separately approved ABA-safe design. #890 creation-card
cancellation remains deferred: POST LeaveRequest has no can_cancel. No API,
PENDING-based authority inference, cast or unbounded pagination was introduced.

Guard pass: clean-code-guard checked the production extraction, hook rules and
composition boundary; test-guard checked transport mocks, visible outcomes,
per-attempt resolver ownership and preserved assertions; docs-guard checked this
receipt against commands/source. These are implementer self-checks, not the
parent's required fresh independent review. The three reproducible existing-test
failures prevent any claim of a green full suite or completed quality gates.
Parent must assess those failures and independently review before publication.

Final complete POS rerun: 656/659 passed in 104 files (137.29s); the same
three recovery tests failed. This supersedes the first 652/659 run after the
component mock targets were corrected. Full-suite gate remains FAILED.

Final focused fence + binding after fixture extraction and resolver typing:
24/24 passed (8.89s). Final external mutant again rejected both selected tests
with the intended 5000ms started-probe timeout (14.46s). Final global
pnpm typecheck and pnpm lint passed sequentially after the full-suite rerun.
No independent review is claimed; parent review and remote gates remain pending.

Final pnpm lint:docs (0 errors, 29 existing warnings), pnpm module-map:check,
changed-file pnpm exec prettier --check and git diff --check passed.
HEAD remains 8fffda483b019d7acf8c840780db8b44ae9c7bae; all implementation stays uncommitted.

## Tenth-round Date-only expansion (same unpublished batch)

The owner approved expanding only `leave-recovery.spec.tsx` and
`leave-round6.spec.tsx` to fix and restore Date. Audit-only commit:
`8e9f2a4da68516ca098799410e91178fce187f97`, parent local audit HEAD:
`8fffda483b019d7acf8c840780db8b44ae9c7bae`; published baseline remains
`67ca782d6124c9df3f2a8f842ed0b9396c4f2195`.

Before test edits, `git rev-parse --show-toplevel` verified
`F:/Dev/Worktrees/PosPay/57b-2b-my-leave`; the branch was
`feat/p1-060-57b-2b-my-leave`. Only owner-questions.ar.md was staged and
committed. `git show HEAD:docs/specs/060-ratings-and-staff-app/owner-questions.ar.md`
then displayed the exact question/options/answer before the test edit.
A subsequent byte comparison of git-show output confirmed that the entire
previous audit is an unchanged prefix, and that the working audit equals the
committed audit. The 3/3 history, exceptions 4–10 and prior tenth approval remain.
No new correction round or merge waiver is implied.

Historical evidence retained: the previous full POS run FAILED at 656/659
(104 files), with three recovery cases using expired fixtures. The task handoff
reported a Date-only in-memory diagnostic passing 9/9; that diagnostic was not
rerun or represented as a source-suite pass in this execution.

The only new source edits are beforeEach/afterEach in the two approved test files:
`vi.useFakeTimers({ toFake: ['Date'] })`, fixed
`2026-11-06T18:00:00Z` (before their `2026-11-06T20:00:00Z` expiry), and
`vi.useRealTimers()` in a finally block around cleanup. Other timers remain real.
An inverse-diff comparison verified every other byte of normalized source against
HEAD: assertions, test bodies and timeouts are unchanged. Existing expiry tests,
production and freshness fences are unchanged. Prior tenth implementation is preserved.

Commands in this execution, in order:

- `pnpm --filter @pospay/pos exec vitest run src/my-leave/ui/leave-recovery.spec.tsx src/my-leave/ui/leave-round6.spec.tsx --pool=threads --maxWorkers=2`: exit 0, 2 files, 9/9 tests, 9.20s.
- `pnpm --filter @pospay/pos exec vitest run --pool=threads --maxWorkers=2`: exit 0, 104 files, 659/659 tests, 318.43s.

#890 creation-card cancellation and #891 polling remain explicitly DEFERRED.
Fresh independent review and remote exact-head gates remain pending. This worker
performed no delegation, external Codex request, push, merge or deploy. The audit
commit is the only new commit; implementation remains uncommitted for review.
The first global `pnpm typecheck` passed (32/32 tasks, 59.155s), then
`pnpm lint` FAILED: leave-round6.spec.tsx beforeEach had 61 lines against the
60-line limit after the two Date setup statements. No rule was disabled and no
assertion moved or changed. Clock setup was separated into its own beforeEach
in both approved files; this is still only clock setup/teardown scope.

Final-source reruns, sequential:

- `pnpm --filter @pospay/pos exec vitest run src/my-leave/ui/leave-recovery.spec.tsx src/my-leave/ui/leave-round6.spec.tsx --pool=threads --maxWorkers=2`: exit 0, 2 files, 9/9 tests, 4.32s.
- `pnpm --filter @pospay/pos exec vitest run --pool=threads --maxWorkers=2`: exit 0, 104 files, 659/659 tests, 166.07s.
- `pnpm typecheck`: exit 0, 32/32 tasks, 18.666s (29 cached). Existing build warnings include chunk size and deprecated inlineDynamicImports.
- `pnpm lint`: exit 0, 33/33 tasks, 12.675s (31 cached); existing repository warnings remain.

Final manifest (all implementation remains unstaged/uncommitted):

- Prior tenth work preserved: `apps/pos/src/app/device-body.spec.tsx`, `apps/pos/src/app/device-screen.spec.tsx`, `apps/pos/src/app/leave-recovery-fence.spec.tsx`, `apps/pos/src/app/reception-body.spec.tsx`, `apps/pos/src/app/reception-body.tsx`, `apps/pos/src/app/reception-leave-binding.spec.tsx`, `apps/pos/src/staff-login/ui/staff-login-screen.tsx`, and untracked `apps/pos/src/staff-login/ui/staff-login-panel.tsx`.
- This expansion: `apps/pos/src/my-leave/ui/leave-recovery.spec.tsx`, `apps/pos/src/my-leave/ui/leave-round6.spec.tsx` (clock setup/teardown only).
- Updated existing receipt: `docs/specs/060-ratings-and-staff-app/57b-2b-validation.md` (append-only history).
- Committed audit only: `docs/specs/060-ratings-and-staff-app/owner-questions.ar.md`.

Guard self-checks: clean-code-guard found no new production change in this
expansion; the preserved panel extraction still uses one injected login owner.
Test-guard: Date is a clock boundary; all visible assertions and expiry tests
are preserved; finally restores real Date even if cleanup throws. Final inverse
clock-only comparison again matched HEAD exactly in both test files.
Docs-guard checked the appended claims against source, git-show proof and actual
command results. These are implementer self-checks, NOT fresh independent review.
Final remaining checks (sequential, after final typecheck then lint):

- `pnpm lint:docs`: exit 0, 0 errors, 29 existing warnings.
- `pnpm module-map:check`: exit 0, `module map: ok`.
- `pnpm exec prettier --check` with the explicit changed tracked files, untracked staff-login-panel.tsx and committed owner audit: exit 0, all matched files use Prettier code style.
- `git diff --check`: exit 0. Git notes the existing validation receipt CRLF-to-LF normalization; no diff whitespace error.

Local HEAD remains `8e9f2a4da68516ca098799410e91178fce187f97`; index is
empty. The 11-file uncommitted manifest above is the review artifact. Local
checks are green after the recorded lint correction; independent review and
remote CI/panel/Codex gates are still PENDING, with no external review requested.
Recommended next step: manager commissions a fresh independent review of the
complete preserved tenth batch plus this approved clock-only addition, before
any single publication batch. PR: https://github.com/lolotam/PayPos.systems/pull/882.
## Final independent tenth-round review and publication preparation

A fresh Codex Astra high read-only review of the complete final tenth batch,
including the approved Date-only expansion, returned PASS with no confirmed
new P0/P1/P2/P3. Review task: 20675319-3fc0-4b2e-8553-e8af51d02383.
It covered the 11-file implementation manifest and both audit commits; it
verified source comparisons and git diff --check, but did not run suites.
The 659/659 POS and global local-gate results above are execution receipts,
not independently rerun tests claimed by the reviewer.

Before publication, origin/main is still da775eb5e5b62adcb48b26d1e55fdba1a2ce671f
and the published PR head is still 67ca782d6124c9df3f2a8f842ed0b9396c4f2195.
PR base is main. No external Codex review was requested by this session.
One consolidated publication follows this review; exact-head CI/Mobile and
all four panel receipts remain required afterward, then manager-coordinated
Codex. No merge/deploy or implicit eleventh round is authorized.

#890 remains deferred (creation-card cancellation). #891 remains explicitly
deferred (matching polling may abort recovery and require a second Retry);
freshness/null/abort/query/epoch fences are unchanged, not relaxed.
## Approved limited batch after tenth — local implementation receipt

Published baseline: cc8d31fa5e51e7656109e126dac127969e2dbed2, branch
feat/p1-060-57b-2b-my-leave, verified clean at entry in
F:/Dev/Worktrees/PosPay/57b-2b-my-leave. git rev-parse --show-toplevel was
verified before git writes. No new owner timestamp was inferred.

Audit-first proof: c6636243850d3ef2e7729aad7846ea20cfbc144e contains ONLY
owner-questions.ar.md. Before editing tests, git show --format=fuller --stat
HEAD and git show --format= -- docs/specs/060-ratings-and-staff-app/owner-questions.ar.md
showed the exact question, ordered options and owner answer. The preexisting
last line was preserved; adding the audit supplied its missing final newline.
3/3 and exceptions four through ten, their expansions and this new explicit
limited exception remain preserved without reset. #890 and #891 remain
explicitly DEFERRED.

Uncommitted source manifest, exactly two files:

- apps/pos/src/app/leave-recovery-fence.spec.tsx: ONLY the second closed/logged-out/offline loop resets finish/probeStarted for each attempt, waits for the current probe's started Promise and releases that Promise's current resolver. Existing assertions, all test timeouts and the late-response loop remain preserved.
- apps/pos/src/app/reception-leave-binding.spec.tsx: ONLY the two English comments translated into Arabic, preserving channel-registry and selected-login-method meaning.

No production, freshness, API, migration, workflow or other source change.
The only additional uncommitted file is this append-only validation record.

P3 diagnosis history, supplied by the manager and preserved here: external
F:/Dev/Temp/882-r10-second-loop-diagnosis.config.cjs pre-aborts the controller
before Recover after the first iteration of the second loop. Old tests passed
2/2 despite the skipped probe; resetting finish externally failed 2/2. These
are prior diagnosis receipts, not reruns claimed by this implementer.

Same mutation rerun against the fixed tests:

- pnpm --filter @pospay/pos exec vitest run --config F:/Dev/Temp/882-r10-second-loop-diagnosis.config.cjs -t 'closed, logged-out and offline' --pool=threads --maxWorkers=2
- Exit 1, 2/2 selected tests failed at the original 5000ms timeout, 10 unrelated tests unselected by the CLI name filter. No source skip or timeout change. Diagnostic output identifies personal/logout and reception/logout pre-aborts. The transformed source confirms each attempt resets the resolver then awaits started before reaching any release or invalidation assertion; the pre-aborted attempt never starts a probe and cannot pass that barrier.
- Evidence: F:/Dev/Temp/882-post10-mutation.log and F:/Dev/Temp/882-r10-second-loop-transformed.txt. Config and transformed artifacts stay outside the repository.

Successful focused rerun:

- pnpm --filter @pospay/pos exec vitest run --config F:/Dev/Temp/882-post10-validation.config.cjs src/app/leave-recovery-fence.spec.tsx src/app/reception-leave-binding.spec.tsx --pool=threads --maxWorkers=2
- Exit 0, 2 files, 24/24 tests, 35.49s. Evidence: F:/Dev/Temp/882-post10-focused.log.

The external validation config uses the supplied diagnostic base's root,
alias, JSX, jsdom, setup and synthetic API URL, removes all transform plugins
and removes its one-file include restriction for full POS coverage. envDir
points outside the repository. It changes no repository config or test timeout.
The esbuild/oxc precedence warning is retained in the logs.

Global pnpm typecheck: exit 0, 32/32 tasks, 29 cached, 1m23.669s;
F:/Dev/Temp/882-post10-typecheck.log. pnpm lint started only after that
command completed successfully. Historical tenth-round POS 659/659 and P3
diagnosis above remain historical evidence, not substituted for this run.

Test-guard self-check: network boundary remains mocked; existing visible
session/private-cache assertions remain intact, with an independent start
barrier for every attempted recovery. Docs-guard self-check compares these
claims to source, git show and command logs. No production change requiring
clean-code-guard. These are implementer guards, not independent review.
Fresh independent review is PENDING; no review was requested by this worker.
Remote CI and four panel reviews on the eventual new head, then one final
Codex review coordinated by the manager, remain PENDING. No delegation,
push, merge or deploy. Implementation stays uncommitted for the new review.

Additional completed gates on this implementation:

- pnpm lint: exit 0, 33/33 tasks, 31 cached, 2m17.221s; F:/Dev/Temp/882-post10-lint.log. Existing boundaries deprecation warnings remain.
- pnpm lint:docs: exit 0, 0 errors, 29 existing warnings; F:/Dev/Temp/882-post10-lint-docs.log.
- pnpm module-map:check: exit 0, module map: ok; F:/Dev/Temp/882-post10-module-map.log.
- pnpm exec prettier --check apps/pos/src/app/leave-recovery-fence.spec.tsx apps/pos/src/app/reception-leave-binding.spec.tsx docs/specs/060-ratings-and-staff-app/owner-questions.ar.md docs/specs/060-ratings-and-staff-app/57b-2b-validation.md: exit 0, all matched files use Prettier code style.
- git diff --check: exit 0. The existing validation file produces a CRLF-to-LF notice only.
- Inverse source comparison: reverting exactly the current-loop barrier/resolver changes and the two translated comments in memory matches cc8d31fa exactly in both source files. No assertions or timeout changes, no other source delta.
- git diff --cached --name-only: empty. Local HEAD c6636243850d3ef2e7729aad7846ea20cfbc144e; audit-only commit, three uncommitted files (the two tests and this receipt).

Final full POS rerun on this fixed implementation:

- pnpm --filter @pospay/pos exec vitest run --config F:/Dev/Temp/882-post10-validation.config.cjs --pool=threads --maxWorkers=2
- Exit 0, 104/104 files, 659/659 tests, 445.29s. Evidence: F:/Dev/Temp/882-post10-pos.log. This is the new run; the historical 659/659 receipt remains untouched above.

All requested local checks passed; mutation failed as required. No outstanding
owned command remains. Recommended next step: manager arranges NEW independent
review of the three-file uncommitted manifest and audit commit before publication;
then CI and four panel reviews on the new head, followed by Codex once. This
worker did not publish or request reviews. #890/#891 stay explicitly DEFERRED.

## Final independent review of the approved post-tenth limited batch

Fresh Codex Astra high review task 35e13bb5-26bc-45d0-9b2d-b03ea551d11c
returned PASS with no confirmed P0-P3 in the complete final difference from
cc8d31fa5e51e7656109e126dac127969e2dbed2: the second-loop barrier, two Arabic
comment translations, this receipt and audit commit c6636243. The reviewer
checked source inversions, mutation artifacts and execution logs, without
running suites. Test counts above are execution receipts, not independent
suite runs by the reviewer. The original assertions and timeouts are preserved.

Publication preparation verified origin/main remains da775eb5 and the remote
PR head remains cc8d31fa. One consolidated push follows this review. Exact-head
CI/Mobile and four panel receipts remain pending, then manager-coordinated
Codex after findings are settled. No external Codex request, merge or deploy.
The additional exception after tenth does not reset any history or authorize
another correction. #890/#891 remain explicitly deferred, not fixed.