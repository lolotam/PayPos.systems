# 47-2c local verification — 2026-11-20

Slice: package import commit transport and recovery sweep (spec 058 row 47-2c), HEAVY tier.
Base: main `61d576d2543e1cca748c635a9668398483a6e130`. No migration, no API, OpenAPI or frontend change.
Plan and both debate records: [47-2c-plan.md](47-2c-plan.md).

## Who did what

- Plan: Claude Fable 5.2 (medium). Debate: one Astra round (codex `gpt-6.2-astra`, medium),
  APPROVE WITH CHANGES, recorded in plan §10. An interim Fable round ran while both Astra lanes were
  out of quota (plan §9); it is not the Astra review.
- Implementation and correction round 1: GLM 5.3 Flash (opencode).
- Tests-and-guard-skills round: GLM ran out of quota; Kimi CLI ended twice with no output; MiniMax
  ran out of quota after getting the tests green; Grok hung once and then failed with no credits.
  Claude Sonnet 5.5 (effort high), the last lane, completed the round and the review-fix round.
- Guard skills (PP-198, Heavy), run by the implementer: clean-code-guard, test-guard,
  waleed-security-reviewer. One `/code-review` (high) on the full diff by the session owner.

## Gates run by the session owner on the final tree

Private Postgres lane `packages-47-2c` (127.0.0.1:55401) and a private Redis 7 container
(127.0.0.1:56489), one vitest command at a time. The worktree's git-ignored `.env` was created from
`.env.example` with locally generated random values, as `docs/runbook.md` «Per-lane test Postgres»
prescribes; nothing was copied from another checkout.

| Gate | Result |
|---|---|
| `pnpm --filter @pospay/contracts typecheck` | exit 0 |
| `pnpm --filter @pospay/worker typecheck` | exit 0 |
| `pnpm --filter @pospay/worker lint` | exit 0 |
| `pnpm --filter @pospay/contracts lint` | exit 0 |
| `pnpm lint:docs` | exit 0 — `0 error(s), 31 warning(s)` (30 existing `TODO(spec)` warnings plus the new one for 47-2c-Q1) |
| `pnpm module-map:check` | exit 0 |
| `prettier --check` on every changed TypeScript file | `All matched files use Prettier code style!` |

| Tests | Result |
|---|---|
| contracts `src/orders/package-import-commit.spec.ts` | 1 file, 1 test passed |
| worker domain `package-import-recovery.spec.ts` + `shared/__tests__/config.spec.ts` | 2 files, 12 tests passed |
| worker jobs: commit processor, commit stale processor, recovery processor | 3 files, 19 tests passed |
| worker `__tests__/package-import-recovery.spec.ts` + `package-import-recovery-lock.spec.ts` | 2 files, 14 tests passed |
| worker `__tests__/package-import-commit-composed.spec.ts` + `package-import-commit-dispatch.spec.ts` | 2 files, 7 tests passed |
| worker wiring: `known-event-types.spec.ts`, `otp-startup.spec.ts`, `readiness-checks.spec.ts` | 3 files, 26 tests passed |
| regression, orders: four 47-2b commit specs + preview processor spec | 5 files, 26 tests passed |
| regression, staff: import processor, import recovery processor, import recovery | 3 files, 10 tests passed |

Total: 21 files, 115 tests, all passing in one sequence with no edit in between. The full suite,
the API shards and E2E were not run locally; they are `ci-gate`'s (PP-113).

## Failures seen on the way (kept as history)

- First typecheck of the first implementation pass: 5 errors (optional-property typing in the new
  processor and module wiring, two typing mistakes in one spec). Fixed in correction round 1.
- First test runs: one wrong expected ISO string in the domain test; two test job ids (`marker`,
  `stalled`) that collided with BullMQ's own Redis key names, so Redis refused the writes and stall
  detection died silently; row-cloning helpers that copied the partition-proof columns the 0215
  guard refuses on insert; a test that updated `requested_at` on an already requested row, which the
  guard forbids; a fixture that did not seed the `user` row. All were test-side defects; no
  production code changed for them.
- `known-event-types.spec.ts` timed out once at 20 s while prettier was using the CPU; it passed
  unchanged on the next run.

## Findings and their outcome

Guard skills (implementer): 9 fixed. Left unfixed with reasons: the failure-code list duplicated
between the processor and the domain error (fix is outside the slice's files); queue scaffold
duplicated with sibling processors (same); a duplicated test helper (same); processor specs use
use-case doubles (the plan prescribes processor-level tests, and the composed specs run the real
use case); the contracts spec pins the strict id-only shape on purpose; one bare rejection
assertion backed by an elapsed-time bound. Security verdict: no confirmed blocker.

`/code-review` (session owner, 8 findings), all fixed:

1. Important — a failed sweep registration on the last outbox attempt turned the policy's «park»
   into a 2 s retry. The delay function is now resolved once so `null` survives; composed test added.
2. Important — on shutdown the commit worker closed last and could start a new commit that was then
   force-killed. It is now force-closed first, in the module and in `main.ts`; order test added.
3. The sweep job could store raw database error text in Redis. It now rethrows a fixed message with
   no cause; marker test added.
4. The ten-minute decision sat in `jobs/` through a re-export. It is now the domain function
   `packageImportCommitWindowClosed` with its own unit tests; the use case only delegates.
5. Two tests with tight real-time margins now use the injected clock or a bound that still
   separates «did not wait» from the 5 s statement timeout.
6. A test that leaked a worker on early failure now closes it in `finally`.
7. `config.ts` described the provisional budget as measured; it now carries `TODO(spec)` for 47-2c-Q1.
8. The spec row linked to this receipt before it existed; this file closes that.

## Not done

- A true two-worker stalled-job test. The existing documents harness is specific to document
  rendering and could not be reused without new infrastructure. Re-run money safety is proven at the
  database instead: a second `execute` after a commit writes nothing, and a rolled-back first
  attempt followed by a second `execute` commits exactly once.
- The implementer did not check that each new test fails without its fix.
- The fixed 2 s outbox retry delay remains in the sale, preview and staff transports; out of scope.

## Open for the owner

- 47-2c-Q1 (transaction budget) is `PENDING`; the 600 000 ms default is provisional and blocks 47-2d.
- Plan §10 A1: a refusal is final once stored in `import_previews`; a crash before it is stored
  re-runs the job against current data. Accepted for now by the manager; Waleed may reopen it.
