# 58-2 split proposal — first pipeline trial

Date: 2026-10-28. Status: **OWNER-ADMITTED: 58-2a implementation only (PP-70.1)**.
Owner answer verbatim in T3 Code (PP-70.1): «اعتماد التقسيم وبدء 58-2a فقط (الموصى به)».
This document is a planning artifact, not an implementation instruction or a budget reset.
The historical untracked `plan-58-2.md` remains in the original 58-2 worktree;
it is not part of this branch. Historical exhausted attempts remain untouched.

## Lead review of the Opus planning result

The lead inspected `redis-rate-limiter.ts`, its port, the card-scan consumer,
both API Vitest configurations, the lane helper and PP-69.8–9 directly.
No tests, Docker commands or benchmark runs were executed for this review.

Confirmed defects in the old plan:

- The adapter trusts a TypeScript cast of Redis EXEC replies. A command error accompanied
  by a null INCR result can satisfy `null <= limit`; malformed replies must fail closed.
- An HTTP `ApiError` belongs outside the shared adapter. Preserve each consumer's
  established error mapping; a general transport rejection must not be rewritten here.
- `EXPIRE NX` returning zero is legitimate when the key already has an expiry.
- Shared `infra:up/down` must not be used to prepare or terminate this worktree's tests.

Corrections to the planning result:

- PP-69.9 is already the owner's answer about migration lanes and numbering. Do not
  re-ask it. PR #700 (main `53e06528`, 28 October) already reconciled the constitution
  as version 3.2.0. Do not reserve 0189 without refreshing the merge queue.
- Existing domain-only Vitest configuration excludes shared-adapter tests. The default
  API configuration includes them but runs Postgres global setup. Do not claim the
  proposed adapter suite ran under `test:unit` or without Postgres.
- A file count alone does not prove a defective scope. These increments are proposed
  because they separate shared infrastructure, grants and the public capability.
- The optional removal of the request lock and customer lock-mode changes are NOT
  accepted by this review. Revisit with source-based concurrency review for 58-2c.

## Proposed increments

### 58-2a — validate shared Redis limiter replies

One bounded infrastructure change, no migration or rating endpoint.
Allowed implementation paths only:

1. `apps/api/src/shared/adapters/redis-rate-limiter.ts`
2. `apps/api/src/shared/ports/rate-limiter.port.ts`
3. `apps/api/src/shared/__tests__/redis-rate-limiter.spec.ts`

Owner-approved test-only scope extension (PP-70.2; 28 October, verbatim answer in the audit):
«إضافة ملف المحاكي وتصحيحه (الموصى به)».
The fourth path is `apps/api/src/modules/notifications/http/__tests__/push-subscription.fixture.ts`.
Correct only its fake Redis pipeline: `EXPIRE NX` must contribute a command result,
returning 1 when attaching an expiry and 0 if it is already attached. Keep the
endpoint test expectations and all notification production code unchanged.
Evidence: the first nine-file consumer run passed 100 tests and failed 6 because
this fake returned only one EXEC result. The isolated baseline/candidate probe
confirmed the missing command result; the production validator must remain strict.

Add a typed infrastructure-unavailable error following the existing port-error
precedent, with Arabic JSDoc. Validate the EXEC envelope and both command results.
Reject missing/malformed results, either command error, invalid/non-positive/unsafe
INCR results, and invalid expiry results. Permit numeric EXPIRE replies 0 and 1.
Retain normal below-limit, equal-limit and over-limit results. Preserve the rejection
identity of network failures and unchanged behaviour of remember/remembered/count/remaining.
Do not attach Redis reply contents, keys or credentials to the public error.

Meaningful tests use a fake Redis pipeline: valid count boundaries, EXPIRE 0 and 1,
null/invalid envelope and command tuples, command errors, invalid counts and expiry
results, and original network-error identity. No consumer, timeout, dependency,
configuration, key naming or limit-policy changes.

Initial implementation was limited to the first three paths. The approved correction
may edit only the fourth fixture; the lead preserves the three reviewed code paths.
The implementer does not
run shell commands, tests, package installations, Git writes or database operations.
It returns paths changed, reasoning and limitations; the lead reviews before execution.

Acceptance is not a claim that the public opt-out capability is delivered.

### 58-2b — one-way opt-out database permissions and guard

Separate migration, column-scoped grants, UPDATE RLS policy, one-way invoker guard,
privilege inventory and negative tests. Keep customer restoration forbidden by the
binding RT-Q10 answer. Determine numbering from the refreshed queue; retain historical
0188 ownership until verified otherwise. Requires a dedicated reviewed plan before code.

### 58-2c — public opt-out capability

Parser, header token transport, per-IP admission, opt-out orchestration, transaction
adapter, route/error/audit mapping, contract/client generation and acceptance tests.
Depends on the preceding increments. Include clock injection and the harness option
to omit Redis for the fail-closed test. Lock changes require fresh concurrency analysis.
No rating issuance, view/submit/page, restoration, notification activation or server change.

## Verification protocol for 58-2a (expected, not run)

- Refresh base and preserve old dirty artifacts; implement in a separate scoped worktree.
- Inspect lane scripts and all delivered changes before executing them.
- Use the existing owned helper `node scripts/test-db/lane.mjs up <trial-lane>` from
  the trial worktree. Confirm its override points to that worktree's private Postgres.
- `pnpm --filter @pospay/api typecheck`
- `pnpm --filter @pospay/api lint`
- `pnpm --filter @pospay/api exec vitest run src/shared/__tests__/redis-rate-limiter.spec.ts`
- Run the existing employee-card limiter regression and the applicable session,
  sign-out, devices, push and attendance-statement suites after identifying their
  exact paths and reviewing their prerequisites. Record each actual result separately.
- Shared Redis may be used only via the existing harness isolation; never stop it,
  clear it or produce failures by disconnecting other tasks. If prerequisites are
  unavailable, report the blocker rather than running the shared compose lifecycle.
- `pnpm lint:docs`, `pnpm module-map:check`, `git diff --check`, scope verification.
- Tear down only the owned trial Postgres after verifying helper ownership checks.
- Astra independently reviews the exact patch; full `pnpm check` remains required
  on CI for the exact merge head. Apply the five-reviewer, backup and staging gates.

## Estimates and admission

Planning estimates are uncertain, exclude provider limits, owner waiting, additional
corrections, CI/bot queues, backup and deployment. For 58-2a: implementation 30–90
minutes (low confidence), lead checks 15–45 minutes (low), independent review 30–90
minutes (low). Record observed durations rather than treating these as commitments.

The owner admitted this explicit split and 58-2a only as the first trial while
preserving old exhausted attempts. See `owner-questions.ar.md` for the verbatim answer.
58-2b and 58-2c still need their own scoped plans before implementation. Publication
retains every standing review, test, backup and deployment gate.
