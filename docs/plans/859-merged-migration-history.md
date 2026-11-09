# Task #859 — Preserve merged migration journal history

Task: https://github.com/lolotam/PayPos.systems/issues/859.
Branch: fix/859-merged-migration-history; original preflight base: a47fc3fe7c748be632b1b3411c0b6a40383b5e68; source-author baseline HEAD/main: 94138d1041787e0d3af7b287744b39f7b584c4d5, reconciled by fast-forward after verifying PR904 was disjoint and preserving this plan.
This plan was prepared under PP140 by codex/gpt-6-astra with reasoningEffort=high; the local decisions are not claimed merged.
Planning does not count as PP136 advice, original independent design advice, internal code review, implementation, or manager approval.
Fresh PP136 and original independent design advice completed in separate Astra/high contexts with full reading audits; the manager personally accepted the consolidated plan and four clarifications in the single design review, recorded in the sealed manager source handoff.
Source remains authorized within the same five paths; the initial 450 ALL ceiling was raised to 600 for #859 only by Waleed's explicit approval (PP145). Initial MiniMax authorship remains historical; interrupted recovery on 2026-11-08 uses OpenCode Grok 4.7 high in this same assignment, and the candidate stays unaccepted. This handoff grants no test, review, merge or deployment PASS.

Scope is the repository validation guard: reject removal or same-idx tag replacement of any trusted base journal entry, and reject an entirely empty candidate journal.
Only scripts/migration-chain/check.mjs, scripts/migration-chain/check.test.mjs, optional focused scripts/migration-chain/base.test.mjs, .github/workflows/ci.yml, and this plan may change.
Workflow edits are confined to the existing check job's trusted base availability/input; packages/db/**, real migration artifacts, app source, manifests, lockfile and deployment/runtime configuration remain read-only.
No schema, database, Redis, secret, server, release-control or production work belongs to this task; SQL/snapshot content immutability beyond existing checks is not added.
The parent's captured reproduction shows coordinated final-entry/SQL/snapshot deletion and empty history both returning no errors; three baseline tests and the repository CLI passed before the fix.
Those are baseline gap receipts, not evidence that this plan or a future implementation passes; the captured base has 215 entries through idx 216, including historical gaps.

checkMigrationChain keeps its three inputs plus one optional fourth trusted-base input `{ journal, sha }`; the partial's fifth argument is folded in so diagnostics name the SHA without a fifth parameter. Ordinary pure fixtures omit it; CI CLI validation must supply `--base`.
Add an explicit empty-candidate diagnostic while preserving existing SQL, tag-prefix, idx-order, snapshot-presence, orphan, identity and prevId diagnostics and their original assertions.
Validate the base as a JSON object with a nonempty entries array, nonnegative safe-integer idx values, nonempty string tags, unique identities and the existing allowed idx sequence/prefix rules.
Do not inspect base SQL or snapshots to establish identity; the comparison contract is every base idx with its exact tag.
Build candidate lookup by idx and report each missing base idx or changed tag with base SHA, journal path, idx and expected/actual identity.
Existing duplicate/order validation remains authoritative for malformed candidate chains; comparison must not overwrite or conceal its diagnostics.
Keep historicalIdxGaps {117:120} and historicalGaps {129,135,190,205}, including the mandatory latest snapshot; valid unchanged and appended histories must pass.

The CLI adds --base <commit-ish>; reject unknown, repeated or missing-value arguments with exit 1 rather than silently ignoring them.
Keep repository and candidate paths anchored to the checker module's repository root, independent of the caller's current directory.
Resolve the supplied ref once using Git rev-parse --verify --end-of-options with its commit dereference, then read <resolved-SHA>:packages/db/migrations/meta/_journal.json using Git show.
Use child-process argument arrays with shell disabled and a fixed repository cwd; never interpolate refs, paths or arguments into shell command strings.
Treat failed Git execution, missing commit/blob, unreadable output, invalid JSON or malformed base shape as explicit base failures with exit 1; no empty/default base and no network fetch inside the checker.
A local invocation without --base retains candidate consistency checking, now including empty-history rejection, and explicitly reports that merged-history comparison was not requested.
A local invocation with --base origin/main or an exact SHA performs both checks and fails if resolution fails; it never silently downgrades.
With CI=true or GITHUB_ACTIONS=true, require --base as a full nonzero 40-hex commit SHA and GITHUB_EVENT_NAME equal to pull_request or push; omitted, blank, invalid or unsupported inputs fail before any success message.
Successful output distinguishes consistency-only from comparison against the resolved SHA; every validation or loading failure exits nonzero.

Set fetch-depth: 0 on the check job's own existing actions/checkout@v7 step; changes-job history is not shared with that job.
Preserve checkout's existing PR merge-ref and push checkout behavior; do not switch it to the contributor branch or change another job.
In the migration-chain step, set MIGRATION_CHAIN_BASE_SHA from github.event.pull_request.base.sha for pull_request and github.event.before for push only; any other or missing event is an empty string, never a fall-through to event.before, HEAD or github.sha.
Pass that environment value as the quoted argument to pnpm migration-chain:check --base "$MIGRATION_CHAIN_BASE_SHA"; retain the existing Node fixture command.
For CI GITHUB_EVENT_NAME=pull_request, require HEAD to be a merge commit with exactly two parents and its first parent to equal the supplied event base SHA; a single-parent commit or mismatch fails explicitly.
For a push, compare against the event's previous main tip, including multi-commit pushes; never substitute the pushed HEAD, origin/main after checkout, or an arbitrary first parent.
Any --base comparison explicitly rejects git rev-parse --is-shallow-repository=true, even if the base blob is present; missing objects, an unavailable force-push predecessor or an all-zero before value fail closed. Local consistency-only mode requires no Git.
No new job, trigger, permission, timeout, needs change, gate relaxation, runner change, cache change or telemetry edit is authorized.

First implement focused failing fixtures, then the comparison/base loader and CLI, then the check-job input wiring; the parent reads every delivered change before executing it.
Keep every existing test assertion; add explicit empty-history coverage and retain the real-repository consistency test.
Separate the existing long table's case construction from its assertion callback, using a module-scoped lexical block so table rows stay in place and callbacks remain at most 60 lines.
Use base.test.mjs only for cohesive base-comparison/Git/CLI responsibility; all changed source/test files stay at most 400 lines and all functions at most 60 lines.
Cover unchanged history, valid append, coordinated final and internal base-entry/SQL/snapshot removal, same-idx renamed tag with matching SQL, and entirely empty candidate artifacts.
For internal deletion and tag replacement, assert the base-specific diagnostic even where independent consistency diagnostics also appear; preserve valid historical exceptions.
Cover unavailable commits, missing journal blobs, invalid JSON, malformed or empty base entries, missing/invalid CI base or event inputs, and a shallow repository whose base blob is demonstrably available.
Exercise actual CLI exits/output, local no-base mode, ref resolution, PR parent match/mismatch/single-parent rejection, and push-before selection; assert the actual check checkout and migration-chain YAML wiring. A two-commit push fixture deletes the latest migration first, then makes an unrelated change, so before rejects while an incorrect HEAD^ comparison would pass.
Use only owned temporary Git repositories for CLI fixtures, with argument-array Git/Node calls and an inspected checker in the temporary repository layout; never reset or branch-manipulate the task repository.
Assert cleanup ownership and the exact temporary root before removal; subprocess environments explicitly isolate scenario CI/base values from inherited runner values.

The parent runs node --test "scripts/migration-chain/*.test.mjs", the repository consistency CLI, and comparison against the captured SHA, then records exact commands, exits and diagnostics.
Run focused formatting on changed files and applicable lint/size checks, pnpm lint:docs and pnpm module-map:check using existing tooling; inspect configuration to determine actual MJS/typecheck/boundary coverage.
Record unavailable checks and genuine N/A results separately; required verification remains outstanding until satisfied, never relabeled PASS because dependencies are absent.
No install/build is needed for the Node/Git fixtures; if another applicable check needs dependencies or generated artifacts, use only the parent's authorized frozen-install/build resource turn.
Do not run local full/heavy suites, E2E, database tests or containers for this guard; retained CI component coverage and ci-gate remain required on the exact final head.
Historical budget stop, 2026-11-08, OpenCode Grok 4.7 high: complete CLI/Git proof did not fit the then-current 450 ALL ceiling. That stop is history, not an open approval. Waleed approved 450 → 600 changed lines for #859 only, same five files, all required tests, independent reviews and CI checks (PP145). Parent measured the pre-correction candidate at RAW 564 ALL and FORMATTED 598 ALL with pinned Prettier 3.9.8 (checker 204, old tests 29, new base.test 286, workflow 11, this whole plan 68). No test, review, merge or deployment PASS is claimed.
The correction adds `--no-local` to the shallow local-path clone, preserving its shallow/blob/rejection assertions. Parent verification on 2026-11-08: focused Node tests 12/12 passed; consistency CLI and comparison against `94138d1041787e0d3af7b287744b39f7b584c4d5` exited 0; four-file Prettier check passed; lint:docs had 0 errors and 29 existing warnings; module-map check passed. Supplemental explicit MJS file400/function60 checks passed; repository size-rule/typecheck coverage does not include these MJS files. Independent CODE, exact-head external reviews/CI and remaining merge gates are still outstanding. Ceiling is 600 ALL for #859 only.
The first pnpm script automatically restored 1024 missing dependencies from the local store with 0 downloads; subsequent manifest/config/lockfile tracked diff was empty and all five candidate hashes stayed unchanged during validation. No global configuration, application service, commit, push, PR, merge or deployment was changed by these checks. Exact commands and outputs are retained by the parent; full/heavy CI coverage is not inferred from focused local success.

After source handoff, refresh live main and reconcile the task branch while preserving this plan; re-evaluate any overlap before authoring. Discoverable lint/config coverage, installed tooling, fixture portability and CI event/object behavior are resolved by inspection and focused execution, not invented owner questions.
No new business decision is identified; the manager owns scope amendments and workflow overlap coordination. #830 owns only its separately approved synthetic browser job and final gate references; #859 owns only existing check-job trusted base availability/input.
Keep #859's truthful correction counters separate from historical #852; retain PP131.2 code-three/docs-one caps, PP119 consolidated panel findings and all five exact-head external receipts with final-head Codex timing.
Before merge, require current tested-base freshness, verified applicable current-batch backup and exact restore, and coordinated published order; snapshot f64a01be belongs to batch 903→904 and is not this task's receipt.
The parent immediately notifies its owning manager at genuine phase completion or a decision blocker; this planner sends no notifications, creates no PR, commits, pushes, merges or cleanup, and does not retry the recorded ntfy HTTP403/code40301.
For later PR waits the owning parent watches and ends its turn; planning completion alone never releases source, merge or deployment gates.
