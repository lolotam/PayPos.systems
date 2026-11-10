# Rating claim state — isolated performance repair

Status: manager verified the bounded lint corrections, 2026-11-10. Fresh post-correction correctness passed 458/458 across eight files with zero skipped, exit 0, 21.48 seconds; worker lint/typecheck, scoped Prettier, docs lint, module-map and diff checks passed. Existing boundaries notices and 29 documentation warnings remain. Fresh independent Astra review found no actionable code/test defects and no required code change before draft CI. Performance acceptance and exact-head CI remain pending; correctness timing is not performance proof.

Lint corrections only: replace the new test's dynamic property deletion with the same three explicit constant-key deletions; move Arabic WHY prose out of the embedded Lua string into top-level JSDoc and retain English Lua comments. No helper behavior, assertion, test matrix, config or gate changes. Parent-reported errors were `@typescript-eslint/no-dynamic-delete` at new test line 183 and `no-restricted-syntax` at helper 30:44 (Arabic literal inside the TypeScript template string). This worker ran no checks.

## Authority and boundary

- Owner authority: [CI-Q1](owner-questions.ar.md). One isolated repair in the fifth slot; original PRs #910/#911/#912/#913 remain untouched. Admin race repair is a later task.
- Supplied worktree: `F:/Dev/Worktrees/PosPay/fix-ci-rating-claim-performance`; branch: `fix/ci-rating-claim-performance`; base: `ff551062ce56a9a57cd6aa7a9abd6f67e1a2bbb2`. Git identity/base are supplied, not independently checked in this native-file-only stage.
- Retained batch exception: Sol planning, Sol medium initial implementation, Astra read-only advice. Original task ownership persists for initial implementation and its failed attempts. Completed independent Astra advice was supplied by the parent and incorporated into the plan; manager consolidates required receipts and reviews this plan before dispatching implementation. This worker performed no delegation.
- Manager personally reviewed plan/diagnosis/helper/performance gate/Astra advice and all 203 lines of the new test before baseline execution. Parent reports 31/31 new tests PASS on the unchanged helper and 458/458 focused correctness tests across eight files PASS, exit 0, 14.80 seconds, including depth/bytes/precision/fences/corruption. This worker did not run or independently verify those receipts. They characterize correctness, not a new functional RED or performance proof.
- Following that checkpoint, manager authorized production edits ONLY to `apps/worker/src/modules/customers/persistence/rating-claim-state-validate.lua.ts`, plus these three documents. The later bounded lint correction changed only the new test's deletion syntax and embedded comment language, as recorded above. All existing tests, settle and every gate remain unchanged. Parent reviewed every changed code line before post-change checks.
- CI-Q2 owner clarification, supplied by parent: `Approve private Redis`. Parent reports Redis 7.4.11 at `127.0.0.1:54896`, NEW disposable task-owned, independent credentials, no persistent volume, focused correctness only; no shared/other-task environment or Redis, no PostgreSQL or environment copy. External Vitest config removes only unrelated global PostgreSQL setup and excludes heavy performance. This worker may not provision, execute commands or read environment files. Parent owns the read-only-to-worker `owner-questions.ar.md` audit update.

## Goal

Repair the repeated worker performance failure without changing rating scheduling, attribution, storage schema, fencing, rejection semantics, or any quality gate. This is a persistence serialization optimization, not new business logic.

## Requirements

1. Every safe integer through `9007199254740991`, positive or negative, survives stored JSON, raw reply, codec, and subsequent fences exactly. Apply this to unknown nested object/array fields, not only known counters.
2. Preserve cjson admissibility, including non-finite/type/depth rejection and the extra reply-wrapper depth. Keep the native cjson validation call; do not alter global precision/depth settings or replace it with a weaker hand-written validator.
3. Preserve Unicode, all cjson escapes (including slash and DEL), strings containing numeric-looking text, null, empty-collection compatibility, object keys, and existing fractional/unsafe-number behavior. Unknown state fields survive unchanged in value; do not claim canonical key order or original formatting on successful rewrites.
4. Preserve exact encoded-byte caps and reserve accounting. No approximate sizes, character counts, reduced padding, changed capacity, or new acceptance window. A refusal retains the original Redis bytes and old version/fence. Redis atomic execution and write ordering remain unchanged.
5. Existing tests are immutable gates: no assertion, fixture, skip, timeout, pinned baseline, harness, runner, workflow, or shared checker edits. New focused functional regression tests are required for the proposed fast path.
6. Heavy performance proof stays CI-only. The parent's narrowly approved private Redis permits focused correctness baseline/regression tests only, not heavy performance, borrowed environment, forced `CI`, or substitute timing claims.
7. No index, migration, public export, API/port/domain change, root config, dependency, lockfile, workflow, or unrelated cleanup. No production deployment/server/secret action.

## Acceptance criteria

- The unchanged `apps/worker/src/modules/customers/persistence/__tests__/rating-claim-state-performance.spec.ts` passes on fresh exact-head CI: patch p95 <=50 ms; patch p95 <=`max(2 * base.p95, base.p95 + 5)`; patch max and baseline max <=100 ms.
- Preserve pinned baseline `ec26930497f25213b62e2b60bc603af6b9ba3527`, all six baseline files and integrity checks, alternating blocks, 20 warmups and 100 samples per variant, all five scenarios, 2047/2048 retries, 75-entry page, 1 MiB cap and near-cap fixture of cap minus 128 bytes. The whole 75-settlement-page test must also pass. Do not increase the current 20000 ms test timeout.
- New focused tests prove ordinary-number encoding and fallback at both signs of the precision boundary, nested unknown high integers, and actual write/reply round trips. Existing numeric, transition, bytes, corruption, invariants, inputs, and write-contract suites remain green.
- Required local non-heavy checks have real receipts, with blocked checks explicitly listed. Local skips do not count as runtime proof. Required full CI and review gates still apply before merge; no merge or release is part of this planning delivery.

## Interfaces, permissions, schema, business rules

Unchanged. The shared Lua helper remains private to the five script families; all ten adapter commands retain their contracts. No new tenant table, RLS policy, index, migration, permission, or user-facing behavior is proposed.

## Evidence and unresolved proof

See [diagnosis.ar.md](diagnosis.ar.md) for supplied CI evidence versus source-proven work amplification; see [plan.md](plan.md) for the exact proposed implementation scope, alternatives, and verification split. Runtime causal attribution and sufficient speedup remain unproven.
