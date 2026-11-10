# Rating claim serialization — bounded proposed plan

Status: manager reviewed the bounded lint corrections and reran the local checks successfully, 2026-11-10. Fresh post-correction correctness: 458/458 across eight files, zero skipped, exit 0, 21.48 seconds (not performance evidence). Worker lint/typecheck, scoped Prettier, docs lint, module-map and diff checks passed; existing warnings remain. Fresh independent Astra review found no actionable code/test defects; CI performance remains pending. Historical checkpoints below retain their original worker-only execution limits.

## 1. Evidence boundary

Required governing files and task owner record were read in the required order. No Graphify graph is available (task brief); discovery used only the named persistence subsystem and its test neighbors. No shell, Git, execute, MCP, network, environment, secrets, outside-worktree reads, or subagents were used. Supplied CI logs and base identity were not independently fetched. The historical baseline source cannot be extracted under these tool fences; only its pinned loading/integrity mechanism was inspected.

Source establishes avoidable encoding work, not its measured share of command latency. The unchanged CI failure is the existing RED performance test; it is not a license to claim a speedup before runtime proof.

## 2. Recommended first implementation

Keep `pcall(cjson.encode, value)` as the admission check and retain its successful encoded string. Before returning that string, inspect the entire admitted value with a lightweight iterative table traversal for numbers that require exact rendering. Scan unknown fields and arrays too. Do not allocate a frame per scalar, stringify every scalar, concatenate tokens, or scan/copy large strings on this ordinary-number path.

Following the independent Astra advice supplied by the parent, native eligibility is conservative: every number must be a finite integer with absolute value <`100000000000000`. Larger integers, fractional numbers and unsafe numbers select the unchanged exact renderer. Values below this boundary have at most fourteen decimal digits; the current helper documents cjson's fourteen-significant-digit behavior. Confirm this premise against the real CI cjson runtime with explicit boundary cases before accepting the optimization. Negative-zero ambiguity excludes the native path, not the command: use the unchanged exact fallback if negative zero is distinguishable; ordinary zero must remain eligible. Do not use a zero check that disables the native path for all ordinary fixtures.

The container-only iterative scan checks ALL nested values and keys, not only known fields. Eligible containers are string-keyed objects, dense arrays and empty tables. Mixed, sparse or other-key shapes fall back unchanged. Inspect numeric keys for valid dense-array structure without allocating scalar frames; do not turn tables into objects or rewrite keys. Preserve booleans, strings and cjson null. A conservative fallback for additional uncertain shapes is acceptable; a false negative is not. Do not infer safety from `version` alone or search encoded text for a field name.

For precision-sensitive trees, keep the existing iterative exact renderer, including `string.format('%.0f', value)`, cjson string/other-number behavior, and cjson admission. Reuse the already completed admission check rather than calling it again. Do not replace the exact fallback with bare cjson, numeric-field allowlists, placeholder strings, regex replacement, recursion, or a guessed depth ceiling. The native string is never returned if a nested safe integer needs exact rendering.

This attacks all five families through their existing interpolation without changing their command bodies. It is deliberately narrower than settlement caching. Expected complexity remains linear in the admitted tree, but ordinary states avoid the second full token renderer and its per-node allocations. Large padding remains a native cjson string operation rather than a Lua escaping scan. These are expected mechanisms, not measured outcomes.

### Exact proposed application/test write scope

1. `apps/worker/src/modules/customers/persistence/rating-claim-state-validate.lua.ts` — guarded native encoding and precise fallback; update the existing explanation with the code.
2. `apps/worker/src/modules/customers/persistence/__tests__/rating-claim-state-encoding.spec.ts` — NEW focused real-Redis functional regression suite, reusing existing fixtures without editing them.

No other application/test path is proposed for the initial attempt. In particular, the performance spec and all existing functional tests remain read-only. The six inspected Lua files are the shared helper plus acquire, lease, reserve, settle and sweep; five executable script families, not six independent command bodies.

Manager clarified the size metric: target <=400 ADDED PLUS DELETED production/test lines, hard max 800; count both sides of replacements, not only newly authored lines. Final manager Git/file count: helper 54 additions + 6 deletions, new test 205 additions, total **265**. Planning documents are outside that application/test size metric. Keep each file under existing lint limits; do not split merely to bypass them. Stop and explain before expanding scope/target; no delivery above 800. Do not edit public `index.ts`, migrations, root/config/workflows/lockfiles/shared checkers.

## 3. Functional tests before production changes

Add the new test file first; record which tests characterize existing behavior and which would catch an unsafe proposed fast path. Existing performance RED supplies the bug reproduction; do not invent a functional RED if the current correct-but-slow codec already passes these regressions.

- Test ordinary native-compatible trees and signed values immediately below/at/above `10^14`, plus the existing `MAX_SAFE` and neighboring boundaries. Assert decoded values and full decimal tokens for fallback integers.
- Put high integers in unknown fields several objects/arrays deep while all known counters are ordinary. Assert actual persisted bytes, raw reply values, adapter reads, and a subsequent successful fence. Include a high version with ordinary unknown fields to exercise small no-value refusal replies.
- Use an explicitly eligible compatibility fixture with ordinary zero and small numbers, separate from the existing compatibility fixture containing `-MAX` (which necessarily falls back). Include numeric-looking strings, quoted/escaped string keys, Arabic/emoji, null, empty arrays/objects, booleans and dense arrays. Through a real Lua helper probe, also check mixed/sparse/other-key shapes and negative zero against the unchanged renderer. Fractions and unsafe numbers deliberately fall back; compare their existing behavior rather than treating them as exact-safe integers.
- Exercise the optimized shared helper directly in a real Redis EVAL for ordinary-shape byte compatibility with cjson, and through real command transitions for persistence/reply behavior. No fake Redis, no mock-only assertion, no implementation-text assertion standing in for behavior, no elapsed-time assertions in the new suite.
- Reuse the existing actual-depth oracle tests rather than duplicating their depth search. Run all existing numeric/transition tests, exact UTF-8 byte-cap +/-1 tests, corrupt-byte preservation and write/fence/overflow tests unchanged. These cover the helper's consumers, not just an isolated encoder.
- Test additions must be small, deterministic and parameterized for genuine boundaries; avoid multiplying every number by every transition. Parent reviewed EVERY test line before baseline execution; this worker runs nothing. Passing values characterize behavior and do not alone prove which native/fallback branch executed. The 203-line new test remains unchanged during the production phase.

## 4. Verification split (commands proposed, NOT RUN)

Updated parent receipts: frozen-lockfile dependency installation succeeded in 30.6 seconds; worker `^...` TypeScript dependency builds succeeded. This worker did not execute or independently verify those commands. CI-Q2 owner answer supplied by parent: `Approve private Redis`. Parent may provision one NEW disposable task-owned Redis 7, loopback-only, independent credentials, no persistent volume, for FOCUSED CORRECTNESS ONLY. This is not infrastructure authority for this worker and does not permit shared/other-task environment or Redis. No package/config/lock changes are needed. Parent owns the owner-question audit update; this worker leaves it untouched.

Parent subsequently reports the private runtime is Redis 7.4.11 at `127.0.0.1:54896`, with independent credentials, no shared infrastructure, no PostgreSQL and no environment copy. After line-by-line test review, new suite 31/31 PASS on the UNCHANGED helper; eight-file focused correctness set 458/458 PASS, exit 0, 14.80 seconds, including actual depth/bytes/precision/fences/corruption. Native numeric-format controls thus have reported local runtime evidence; CI remains authoritative for performance. No invented functional RED. This worker did not run these commands or independently inspect their logs.

### Local non-heavy, after dependencies are available

- `pnpm --filter @pospay/worker typecheck`
- `pnpm --filter @pospay/worker lint` (includes configured boundary rules; no separate invented worker boundaries script)
- `pnpm lint:docs`
- `pnpm module-map:check`
- `pnpm exec prettier --check docs/specs/ci-rating-claim-performance/spec.md docs/specs/ci-rating-claim-performance/plan.md docs/specs/ci-rating-claim-performance/diagnosis.ar.md apps/worker/src/modules/customers/persistence/rating-claim-state-validate.lua.ts apps/worker/src/modules/customers/persistence/__tests__/rating-claim-state-encoding.spec.ts`
- Parent will execute focused real-Redis correctness with an external focused Vitest configuration WITHOUT the worker's PostgreSQL global setup. Existing test bodies and harness stay unchanged. Worker `vitest.config.ts` installs `packages/db/test/global-setup.ts`; a filename filter alone is not safe. Parent verifies configuration and private Redis provenance before running; this worker neither writes that external config nor reads environment/credentials. Run the new suite against the UNCHANGED helper first, then existing focused numeric/transition/bytes/fence suites including the existing wrapper-depth oracle, through that bounded correctness lane. Parent reviews the baseline receipts before resuming helper implementation.

Full `pnpm check`, heavy performance, full suites, build/images and other CI-only gates do not move local. No `CI=true`/`CI=1`, copied environment or shared/staging/other-task fallback. Private Redis authority is limited to the parent's CI-Q2 correctness lane above.

### Existing CI runtime lane

The orchestrator confirms that the existing worker CI job collects the new `src/**/*.spec.ts` test (worker config does) and runs the unchanged functional neighbors plus the heavy performance gate using its existing isolated services. No workflow edit is proposed. Capture exact-head/merge-base identity, baseline SHA/blob receipts, Redis image/server metadata, all scenario sample counts and median/p95/max reports, and whole-page results. Keep supplied failures distinct from new results.

If an initial relevant fix remains RED, retain original implementation ownership and diagnose that attempt. Existing per-scenario reports already expose end-to-end variant measurements. If they cannot distinguish serialization from validation/decode/reply cost, propose a bounded diagnostic CI-only test at `apps/worker/src/modules/customers/persistence/__tests__/rating-claim-state-encoding-diagnostics.spec.ts` for separate approval BEFORE adding it. It would compare actual cjson admission, guarded traversal and exact rendering on the same synthetic shapes without altering production logic, baseline, caps or assertions. Diagnostic work stays outside the original gate's timed regions; the unchanged whole-command gate remains authoritative. Its 20000 ms timeout covers a whole test, not an individual command. This path is conditional, not part of the initial two-file scope; do not rerun unchanged application failures or call runner load the cause. Do not change a workflow just to collect diagnostics.

## 5. Alternatives and stop conditions

| Option | Benefit | Risk / disposition |
| --- | --- | --- |
| Guarded native cjson plus exact fallback | Smallest shared-helper change; preserves all-integer precision with no command rewrite | Recommended; traversal completeness, native byte compatibility and sufficient speedup need CI proof |
| Reduce allocations in exact renderer only | Precision path stays uniform | Still renders every token in Lua and scans padding; useful later only if measured necessary, not assumed sufficient |
| Reuse one exact state encoding for size/store/reply | Removes repeated whole-state encoding in settle | Mutation invalidation, overflow rollback and reply-wrapper admissibility hazards; defer until profiling justifies a separately reviewed exact scope |
| Native cjson everywhere / change precision / known-field-only patching | Superficially fast | Reject: loses nested safe integers or changes compatibility |
| Relax test, skip, timeout, baseline or load waiver | None acceptable | Forbidden by CI-Q1 |

If native output changes byte-cap decisions, depth behavior, unknown-field values, cjson rejection, or corrupt/fence atomicity, stop and revise the algorithm; no contract change is authorized. If measured gains are insufficient, report the failed attempt with evidence before expanding the two-file scope. No business question is open; technical rescope or new diagnostic paths go through the owning manager. No independent owner contact/publication from this worker.

## 6. Handoff and gates

Manager personally reviewed spec/plan/diagnosis/helper/performance gate/Astra advice, all 203 new test lines and baseline receipts, then authorized this same original task session to change ONLY the helper and three task documents. Independent Astra advice confirmed helper-first native encoding, conservative whole-tree eligibility and deferred settlement caching. No separate advisor receipt is claimed by this restricted worker. Parent must read EVERY changed production line before post-change 458-test correctness and static gates. The initial implementer retains any failed attempt until a clean handoff. Required exact-head CI/review/backup/merge gates remain unchanged. No architecture change or new owner business decision is needed. This stage claims no successful post-change checks, commit, merge or deployment.

## 7. Tests-first handoff matrix

- New test: scalar `0`, both signs of `10^14-1`, `10^14`, `10^14+1`, and MAX; ordinary integer formatting controls below the boundary; native rounding control at `10^14+1`. These require actual runtime fourteen-digit/decimal/scientific compatibility, not source-text inspection.
- New test: an eligible ordinary compatibility tree with zero, controls/escapes, Unicode, string keys, dense arrays, booleans, null and empty tables, distinct from existing `-MAX` fixtures. Compare decoded values and UTF-8 lengths, without canonical object key order.
- New test: fractional/unsafe-number fallback behavior, distinguishable negative zero versus ordinary zero, dense/empty/mixed/sparse/nested-sparse/fractional-key shapes, and cjson rejection for invalid keys/non-finite values. Intended eligibility/fallback labels describe the proposal, not measured branch execution.
- New test: unknown nested object/array MAX integers with ordinary known counters, actual stored and raw reply tokens, adapter reads, successful next fences and stale-byte preservation.
- New test: ordinary-state exact UTF-8 release cap and one-byte-below rejection, old-fence preservation and follow-up stale no-write. Existing depth and exhaustive numeric/fencing suites are reused, not duplicated.
- Self-review by native source inspection only: real Redis, no mocks, no elapsed assertions, no implementation-text assertions or production edits. All execution, formatting and baseline outcomes are NOT RUN by this worker; parent reviews every line before execution.

## 8. Authored production algorithm and source-only self-review

`exact_json` ALWAYS calls `pcall(cjson.encode, value)` first, including reply wrappers. On failure it raises the original error. On success, `native_tree` scans every table key and nested value using a stack of table references only, never recursion or per-scalar frames. String-key objects, empty tables and dense positive-integer-index arrays are eligible; mixed/sparse/fractional/other-key tables fall back. Density is checked by positive integral key bounds against `#table` and numeric key count equality, so a sparse table cannot pass just because its length is nonzero.

`native_scalar` accepts strings, booleans and cjson null; numbers must satisfy strict signed bounds within `10^14`, be integral, and not be distinguishable negative zero (`1 / value == -math.huge`). The bound comparisons also exclude NaN/infinity. Ordinary zero passes. Any uncertain scalar/shape sends the WHOLE tree to the existing exact renderer. Native-eligible trees return the already admitted cjson string. Otherwise that temporary string is released and the exact rendering body runs unchanged.

Source-only self-review checked nested traversal, key classification/density, zero sign, admission-before-scan, wrapper depth, unchanged error/write ordering, no mutation, no global cjson settings, no token patching/regex, no key-order assumption and unchanged fallback rendering. No new state schema, public contract or business rule. Remaining risks are runtime compatibility/performance and conservative fallback overhead, not proven resolved by inspection. Post-change tests/static gates and CI performance are NOT RUN by this worker and remain pending parent review/execution.

## 9. Initial-worker lint correction receipt

Parent reports reviewing all actual helper changes before execution, then eight-file focused correctness 458/458 PASS, exit 0, 16.63 seconds, and typecheck PASS. Lint FAILED: new test line 183 `@typescript-eslint/no-dynamic-delete`; helper 30:44 `no-restricted-syntax` because Arabic Lua-comment prose was inside a TypeScript string literal. These are real initial-attempt defects, not waived or handed to another implementer.

Authorized corrections: retain exactly the same expected-state fields/assertions but delete `ownerToken`, `leaseUntil`, `turnStartedAt` using explicit constant keys, not a dynamic loop; move the Arabic WHY to existing outer JSDoc and use English for the two Lua comments. No lint disables, config/i18n changes or runtime helper changes. Source review confirms the semantic matrix and algorithm are unchanged. The new test now has 205 lines before any parent formatting; old 203-line references above describe the pre-correction baseline. Parent must review the exact correction diff before rerunning lint and required focused checks. All post-correction commands/results and heavy performance are NOT RUN by this worker; original failed-attempt ownership remains here until clean handoff.

Manager follow-up supersedes that pending checkpoint: correction diff personally reviewed, fresh local checks passed as recorded in [verification.ar.md](verification.ar.md). Original Sol session returned its source-only handoff without further edits or commands. Fresh independent Astra review completed with no actionable code/test defects or required pre-draft code changes. Manager accepts the source/local-check handoff for draft-CI publication only; performance acceptance remains pending. No exact-head CI, performance success or merge readiness is claimed.
