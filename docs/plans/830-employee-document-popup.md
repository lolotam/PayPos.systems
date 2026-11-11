# #830 — employee-document popup lifecycle

Status: Re-land PR #917 after the #915 revert; `ci-gate` green on `c49b88bd9`; PP-164 size caps apply.
This continues the retained issue #830 after the Kimi quota stop. It is not a clean initial handoff, independent review, PR, release, or browser result. The prior premature-edit reading-gate FAIL stays. PP-146 is a responsibility split, not a review round, a size-rule waiver, or acceptance.

## Authority and preserved history

- Branch/worktree: `fix/830-employee-document-popup`; supplied HEAD/main baseline: `94138d1041787e0d3af7b287744b39f7b584c4d5`.
- PP-151 moved the retained author to Kimi CLI K3.1 Pro/high without resetting history. PP-152 waived only the blocked Fable advisory call; Astra and every other quality gate remain. PP-153 records its named total/HOLD waivers without establishing correctness or test evidence. The parent owns review, measurement, execution, Git, PR and merge work.
- PP-154 approves only `apps/admin/src/staff/api/employee-document-presentation.spec.tsx` at 220 ALL, taking the approved paths from 13 to 14, and accepts notification 146 ALL and browser 355 ALL. Every other path cap and the 400-effective/60-function limits remain. This is a responsibility split, not a measured fit, test result, acceptance, or counter reset.
- PP-160 explicitly changes only the bounded E2E-harness author lane to Codex `openai/gpt-6-astra#high`, preserving all history/counters/constraints. PP-161 adds only `apps/admin/tsconfig.e2e.json` as changed path 15, cap 6 ALL, for `allowImportingTsExtensions: true` in the existing noEmit E2E check. No other path cap, assertion, production configuration, CI requirement or merge/protection boundary changes.
- Earlier MiniMax-only transport and FROZEN/SOURCE BLOCKED wording is historical only where the direct resume mandate superseded it. Technical, security, scope, correction and delivery gates remain.
- The prior planner, dissent, SDK evidence and pending-only design remain preserved in the checkpoint packet. SDK Node evidence is not native-browser proof.
- The first preserved Kimi delivery was incomplete and unexecuted. Its measured hook diff was 226 additions + 68 deletions = 294 ALL, exceeding the 240 hook cap by 54. Other measured paths and the 1296 total did not cure that per-path failure.
- The next corrected hook measured 270 ALL, still over 240; repository-format fixture expansion measured 440 ALL against 300. The quota-stop candidate was still unaccepted. This recovery compresses the hook and rewrites the fixture so preflight matches inventoried method/path/query for both businesses without inferring an absent company-header value. Actual requests still bind company, business and employee. Formatted A+D was not measured by this author.
- Correction work must preserve the three-code/one-doc correction budgets and review history. No reset, new issue, or new task is created here.
- PP-131.2 still allows at most 3 code review rounds and 1 docs review round, counted only as review-to-fix cycles after a clean handoff. Parent reviews 1 and 2 record that no handoff, PR, or independent CODE review exists, so those cycles have not started. This author does not infer a consumed or zeroed counter. PP-146 does not grant a round.
- Owner answer PP-146, recorded by the parent in the canonical audit: approve splitting responsibility into `apps/admin/e2e/employee-document-popup-routes-fixture.ts` and `apps/admin/src/staff/api/employee-document-open.spec.tsx`, each capped at 220 additions+deletions. Allowlist 10 to 12 only. Total 1960 stays. Old path caps, the 400 effective file limit, and the 60-line function limit stay. No 400/60 exception was granted.
- Owner answer PP-148, 2026-11-09: approve `apps/admin/src/staff/api/employee-document-open.ts` at 180 additions and deletions, allowlist 12 to 13 only. The 263-line draft missed that cap and was not accepted.
- Owner answer PP-149, 2026-11-09: raise that same helper to 240 additions and deletions. The React owner stays in `use-employee-documents.ts`. Total 1960, hook 240, browser 350, and the 400/60 limits stay. The premature-edit FAIL, the 406-effective flight candidate, and the 9 historical focused failures stay unaccepted. No test, browser, or CI result is claimed here.
- Owner answer PP-164, 2026-11-11: one-time raise for re-land PR #917 only (after #909 merged on a red `ci-gate` and was reverted in #915). Exact A+D caps vs main: `employee-document-open.ts` 280, `employee-document-open.spec.tsx` 255, `employee-document-notification-race.spec.tsx` 330, `apps/admin/e2e/employee-document-popup-browser.ts` 50 as approved path 16, `.github/workflows/ci.yml` 120, total 2650. Every other cap stays. Audit: `docs/owner-decisions.ar.md` §75.
- Measured failures that this split is answering, not claiming to have cleared: hook formatted A+D 282/240 and `useDocumentOpen` 62 effective lines; fixture formatted 418/300 and 417 effective lines; unit spec 417 effective lines. Parent measures again. This author ran no formatter, test, or lint.

## Production ownership design

1. Preserve `open.mutate(objectKey)` and the existing section/table/column interfaces. A synchronous facade validates the current committed operation and acquires `about:blank` before internal mutation work or any await.
2. Preflight requires the captured scope, current fresh lifetime, installed subscription, current query instance, successful read observed for that lifetime, matching read/write epoch and a currently listed key. Cached success from an earlier mount is insufficient.
3. Native acquisition retains a usable handle, sets and verifies `opener = null`, and rejects null, thrown, closed or non-isolated results before POST. Acquisition failure closes only the acquired blank and exposes fixed bilingual retry text.
4. Each accepted attempt has an opaque token, private key/handle, operation authority and explicit ownership. Same-tick calls coalesce while a valid pending attempt exists.
5. Scope ABA, query removal/recreation, read loss, first key disappearance, StrictMode cleanup and unmount invalidate the affected attempt permanently. Restoration requires a fresh click; old settlements cannot borrow a successor's authority or presentation.
6. `can_manage` loss revokes writes without revoking a permitted read. Existing upload, confirmation, recording, idempotency and cache-eviction behavior remains unchanged.
7. Pending ownership survives until `location.assign` actually succeeds. An assignment exception therefore still closes the owned blank and returns sanitized retry feedback. Successful handoff ends ownership immediately after assignment; no previous successful document is tracked for cleanup or closed by another attempt.
8. No post-COOP closure, byte recall, capability revocation, attachment completion or download-completion guarantee is claimed. Server authorization and the existing 60-second capability remain the security boundary.
9. Mutation variables contain only opaque tokens; mutation results are `void`. Download URLs stay in short-lived settlement locals. Transport, parsing and native exceptions become the fixed bilingual error before entering mutation cache or DOM.

## Focused correctness evidence authored, not run

- Synchronous handle creation before network scheduling, opener isolation and same-tick coalescing.
- Null/thrown/failed-isolation acquisition: zero POST, owned cleanup, visible enabled retry.
- Slow success, request failure, invalid payload, manual close and assignment-throws cleanup.
- Void results, opaque variables, sanitized cached errors and no private URL/exception in rendered feedback.
- Current-mount cached-success rejection and retained StrictMode callback rejection.
- Scope changes, read/write epoch separation and existing upload/privacy regressions.
- Immediate denial handling before delayed observer delivery; key removal/restoration and query recreation permanently invalidate the old attempt.
- Successor presentation/navigation remains independent, and earlier successfully handed-off documents remain open.

These are test intentions and source assertions only. No Vitest, typecheck, lint, formatter or other local command was run by this author.

## Production-integrated browser gate authored, not run

The new `admin-document-popup` CI job requires `[changes, build]` and uses a clean runner and frozen installation. It builds, in order, domain, ids, observability, contracts, i18n, db, auth and the real admin webpack application. UI remains a source-exported/transpiled package; db is a compile dependency only. PP157 permits PR909 alone to collect diagnostic build/native evidence after a failed worker job, only after successful change detection, static/package checks and API shards; native still requires an actual successful build. Explicit cancellation/status checks avoid implicit failed-ancestor skipping. Worker and ci-gate failures remain visible; unrelated PRs and pushes retain their normal worker-success requirement.

The same synthetic `NEXT_PUBLIC_API_URL` is used at build and serve. The real `/staff` route runs through server `SessionGate` and production providers. No real auth/DB/Redis factory, credential, cookie state, migration, seed or external service is used.

The Node 24 fixture uses Node builtins plus the built `@pospay/i18n` catalog for refusal text, and owns strict API/control/destination listeners. One shared inventory governs preflight and actual session, workspace, employee list/detail, documents, download, notification-count and named unrelated-denial routes. Unknown methods/paths, duplicate or unexpected queries, wrong company/business/employee bindings and external origins fail and enter the unknown-request ledger. Preflight header names are exact and duplicate-free; download/control bodies are bounded and validated. No claim is made about rejecting every standard browser header. Real Next HTML/RSC/assets remain on the real admin server.

Fixture health carries the current CI run/attempt identity. Admin readiness is an actual response from the built `/staff` route plus a live owned admin PID; admin exposes no fixture run identity. Both owned PIDs must remain alive. Cleanup targets only those owned processes/listeners. Fixed ports are not reused after an occupied-bind failure.

### Native controls included

- Trusted Open click creates a usable isolated blank before a held response; delayed handoff occurs only after observed inactivity and elapsed time measured by a separate no-opening trusted-click control.
- Matched sandbox denial and permission use the real route and native `window.open`. The result is labeled sandbox-enforced refusal, not ordinary popup-policy compatibility. It checks both locales, zero denied POST/orphan and a fresh permitted success.
- Network failure, invalid payload and manual pending close preserve explicit retry and prevent late destination navigation.
- An offline/online reconnect triggers the documents refresh. Real documents GET 403/404 and its visible refusal/placeholder cleanup occur before the held POST is released. Headless Chromium does not change the opener's visibility or focus when a popup opens, so tab-return refresh is covered by unit tests only.
- Key disappearance then restoration, and denial then genuine query recovery, leave the original held attempt invalid. A fresh successor navigates independently.
- Employee change, panel unmount and workspace change clean their own pending placeholders. Old settlement cannot navigate a successor, and a prior handed-off document survives a later failure.
- Cross-origin COOP and attachment observations record only observed behavior. A download event is registered before response release and proves start only, not byte completion or tab closure.
- Release controls wait until the requested key is actually held in the fixture ledger. No arbitrary sleep is substituted for request ordering.

Every browser result remains PENDING until the exact-head CI job actually executes it. Focused unit tests do not substitute for these controls.

## CI and local boundary

The new job is included in final-gate `needs`, result environment, code-success and docs-skipped expressions. Existing distributed checks, API shards, worker tests, build, images, unknown-classification failure and the #859-owned migration-base subsection are preserved.

After personal parent review, the local boundary is limited to focused admin tests, admin typecheck/lint, `lint:docs`, module-map/boundary checks and formatting. No local Next build, Playwright, heavy suite or browser run is included. Production build and native acceptance belong to the new CI job.

## PP-146 responsibility split

Route inventory and response construction live in the new routes fixture. The original fixture keeps control, download hold, destination, and request lifecycle, and passes `omit` into the document builder. Popup-ownership scenarios live in the new open spec. Upload, recording, and read/write epoch tests stay in the original spec, including the latch test's popup assertions. The hook keeps the HEAD epoch, record, and view text and replaces only the post-settlement `window.open`.

This split is not a formatted-fit claim, a browser result, or an independent review.

## Remaining delivery gates

- Parent must read the complete corrected delivery and measure actual per-path and total A+D against the supplied baseline.
- Parent scoped evidence on the applied PP-154 candidate: six focused files, 41/41 tests passed; admin and E2E TypeScript passed; admin ESLint passed with 0 errors/14 existing incompatible-library warnings; i18n scoped ESLint passed; lint:docs passed with 0 errors/29 existing warnings; module-map passed. Scoped formatting and parser-only 400/60 checks passed. Full CI remains pending.
- Diagnostic CI 42619063611 passed build-all and the synthetic production-admin build, but native module collection failed before any popup scenario ran. Successful native browser, unknown-request ledger and owned cleanup acceptance receipts are still unavailable.
- Independent Astra/high approved the corrected source snapshot; final integrated-head review binding, Codex and exact-head/base CI remain required. PP-153 explicitly waives MergePilot HOLD200 for this named batch; missing panel receipts are not represented as completed reviews.
- Applicable separately verified backup/restore, coordinated merge order and release ownership remain with the parent/manager. No deployment, activation, migration or HOLD change follows from this candidate.

## Parent verification receipt — PP-154 / PP-155, 2026-11-09

PP-155 authorized preserving two externally changed test files and restoring only three deleted test blocks. Current files, hashes and diffs were preserved outside the repository; restoration matched every original source hash before application. No reset, checkout or unrelated change was performed. The approved presentation test moved without consolidating working journeys. Parent removed the resulting unused notifyManager import only.

The external formatted preview measured 2141 ALL across fourteen approved paths; all path caps and 400/60 passed. The applied candidate is measured again after this evidence update. PP-153's corrected formatted-total as-is allowance remains; no size squeezing, assertion removal, timeout extension or lint suppression was used.

The focused presentation regression was also run with only the original generation placement restored temporarily. It failed at the visible enabled-button assertion (expected false, received true for disabled). Restoring the delivered generation fix made the same test pass. The delivered helper was restored exactly afterwards; this is red/green proof of the busy-stuck regression, not a native-browser result.

The six-file focused command and admin typecheck ran on the actual applied source. No local Next build, Playwright, heavy suite or browser ran. PP-153's first four PRs have now merged in order. PR #908 merged as `a2b09bf15e98477d6260e29cab3319840f7d7dc5` under PP-156's one-head temporary admin exemption, with the full branch protection restored exactly and ci-gate still required. Its five performance failures remain owner-waived, not PASS; that exemption cannot be reused for #830.

## Parent P1 correction and current-main integration — 2026-11-09

First fresh Astra CODE review found a P1 in the browser proof: unrelated leave refusal alerts collided with page-wide assertions and shared refusal text. The same retained Kimi K3.1 Pro/high author corrected only three existing E2E paths. Unrelated routes remain denied with distinct synthetic text; document-read refusal assertions require exact document text, and the old-A/B-held proof specifically forbids document retry feedback. No scenario, timeout, skip, production interface or working journey was removed or consolidated. History and correction limits are unchanged.

The corrected formatted candidate measured 2146 ALL, within every approved path cap and 400/60. Fresh six-file focused tests passed 41/41, admin/E2E TypeScript passed and scoped E2E lint passed. Fresh independent Astra/high source review approved all 14 exact hashes, manifest `f5274d583a8bd021c87460147398b14134487dd114b5c7aabf709e32316ff98b`; no native-browser result was inferred. Reviewed bytes were saved in local commit `693bde7bfb5b316dc0a7f88667b3acab311dc8f1`, then current main was merged without conflicts. Only the already-reviewed #859 migration-base additions changed the task workflow during integration; its full-history checkout and explicit base comparison remain intact. Final integrated checks and exact-head CI are still required.

## Parent PP157/158 diagnostic CI receipt — 2026-11-09

Published head `88a4b3e7d45e3da79e8f00f811668319eb56413c` passed integrated 41/41, admin/E2E TypeScript, admin lint (0 errors / 14 existing warnings), lint:docs (0 errors / 29 existing warnings), module-map and migration-base validation. Exact-head Codex completed without findings. Mobile 42607829799 passed both Android builds and mobile-gate; iOS/macOS were skipped. CI 42607829660 passed static/package, all API shards and images, but worker reported 2240 passed / 5 failed in the unchanged inherited rating-performance suite. ci-gate failed; build-all and native-popup skipped. Patch p95 values were 35.521474, 48.752185, 35.991683, 91.106524 and 132.655861 ms; last maximum 138.899022 ms. No measured timing cause or native PASS is asserted.

Owner PP-157 answered `Allow diagnostic CI (Recommended)` for scheduling only; PP-158 answered `Approve workflow107 (Recommended)` for this path's 104-to-107 ALL increase only. All other caps, 400/60, tests, failure evidence, correction history and merge/protection boundaries remain. No threshold, timeout, sample count, continue-on-error or gate result changed. A fresh independent Astra/high review approved the external workflow SHA256 `9a6deacd98b37dc8c501f3e237f4231acf8bab4917afdd1230e824de05a07015`. Local YAML structural comparison found only two executable conditions changed and 16 condition cases passed, not GitHub runtime proof. New exact-head CI/native results and final-head review remain pending; PP-156 cannot be reused.

## Parent PP-160/161 literal-loader stage — 2026-11-09

CI 42619063611 tested published head `e9e97266eecd720c955415d39c7df1fce03ddfdf` as merge `a5863e790a40c706b6ae73fd52537b07da053201` into main `a2b09bf15e98477d6260e29cab3319840f7d7dc5`. Static/package, API shards, images and build-all passed. Native admin build passed, then Playwright collection failed at the fixture's CommonJS path into import-only i18n; no popup scenario executed. Worker was 2240 passed / 5 failed: four emitted p95 samples were 34.754806, 51.046826, 36.251352 and 92.450757 ms; the fifth near-cap retry timed out in 20000 ms without a final sample. ci-gate failed. No runner-variance cause, native visibility timeout or successful native proof is inferred.

Three empty Kimi deliveries remain preserved. Under PP-160 the same retained task moved to Codex/Astra-high without a reset. Its full harness proposal measured fixture 304/300 and browser 389/355, total 2257 ALL, and did not establish silent old-A settlement while B remains held; it remains unapplied and unaccepted. A separate URL-loader stage passed source review, TypeScript and 41/41, but scoped lint rejected the computed import. That actual failure is preserved, not waived.

PP-161 answered `Allow config6 (Recommended)`. The applied loader stage now uses a literal `.ts` ESM import and only the named noEmit E2E compiler option. Independent fresh Astra review approved fixture SHA256 `33cd39327499e63669f1a7b43e09d61d07e9d30fbbb0c235e5e8ad7652a15daf` and config SHA256 `76c9e6e384e8d6f9ff78c470083210366266e753a62b88c4e12ccda6130d34c6`. Fresh parent admin/E2E TypeScript, scoped fixture lint and six-file focused tests (41/41) passed; parser-only 400/60 passed on preserved copies. This is loader-stage source/scoped evidence only, not runtime collection or full PR acceptance.

All eleven browser scenarios/assertions, production hook/helper, catalog, route inventory and workflow remain unchanged by this stage. Visibility, synchronization, all-held drainage and old-A/B-held proof remain open. No local browser, Playwright, application build or heavy suite ran. Fresh exact-head CI/native proof, Codex, tested-base freshness and applicable backup/merge gates remain; no lint suppression, production-config change, new task, counter reset or merge/protection waiver. PP-156 stays closed.

## Parent PP-162 heading and failure-only diagnostics — 2026-11-09

CI42649585594 tested head `1d1c3014847b01aa5d6c585e651739bca40fcdc6` as merge `cf43c2efd5c718ee39e6a2213714c43d535c4319` into main `a2b09bf15e98477d6260e29cab3319840f7d7dc5`. Static/package, four API shards, images, build-all and the native production-admin build passed. Literal ESM loading fixed collection: Playwright ran all 11 tests, but all failed setup. Ten encountered duplicate documents headings (actual h3 and h2); the sandbox case timed out locating its iframe workspace selector. Popup lifecycle proof was not reached. No uploaded popup trace/error-context content or accepted ledger/owned-cleanup receipt is available.

Worker remained 2240 passed / 5 failed; actual emitted patch p95 samples were 35.203886, 51.393598, 34.933863, 94.281519 and 132.587775 ms. The fifth near-cap RETRY timed out in 20000 ms despite emitting its sample, unlike the previous run's missing fifth sample. ci-gate failed; no performance cause or waiver is inferred. Exact-head Codex completed without findings. Mobile42649585617 passed both Android builds and mobile-gate; iOS/macOS skipped. These successes do not replace native acceptance.

Same retained Codex/Astra-high author returned semantic heading level3 disambiguation and failure-only iframe diagnostics that rethrow the original setup error. The heading-only external preview measured browser354/355 and total2196 ALL; combined preview browser378/355 and total2220 ALL. Owner PP-162 answered `Approve browser378 (Recommended)`, approving only that exact browser cap378/preview and mechanical evidence within the existing plan cap. Other caps, 400/60, all eleven scenario/assertion journeys, history/counters and CI/native requirements remain unchanged; no size golfing or consolidation.

Fresh independent Astra/high source review approved browser SHA256 `7ffcfd5ac21a3fa98456ed0b51b20696c64680814e0bbc2db54daabd7fa1c715`. Parent applied exactly those bytes. Fresh admin/E2E TypeScript, scoped browser/fixture lint, full admin lint (0 errors / 14 existing warnings), module-map, migration-chain against a2b09bf and six-file focused tests (41/41) passed. Diagnostics have not run in a browser; the sandbox cause and broader visibility/synchronization/drainage/old-A–B-held proof remain open. The prior larger cap/proof-blocked harness remains preserved and unapplied. No timeout, origin, sandbox, fixture inventory, workflow, production or dependency change; no local browser/build, counter reset or merge/protection waiver. New-head CI/Codex and applicable landing gates remain required; PP-156 is closed.
