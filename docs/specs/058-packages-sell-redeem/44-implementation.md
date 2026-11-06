# Row 44 implementation handoff

Baseline: `cc085aac` (#841). Scope: spec 058 row 44 and issue #843.
Implementation worker: Codex `gpt-6.1-sol`, medium (PP-125).
The parent owns review, execution of gates, Git operations and the PR.

## Design

The existing 054 cancellation remains the only status writer. Its permission,
revision, finality, self, recording-window, reason and tip checks precede the
package reversal. The cancellation ID is allocated once and passed to both the
reversal and the immutable cancellation history.
After acquiring the component lock, authority and the existing 054 rules are
checked again using the fresh clock, so a lock wait cannot keep expired access
or a closed recording window alive.

For a redeemed line, persistence reads the scoped redemption, locks its component
`FOR UPDATE`, conditionally sets the previously NULL reversal fields, then frees
the slot only while it is `USED` by that redemption. Each UPDATE must return one
row. A mismatch raises `SessionError('PACKAGE_REDEMPTION_ALREADY_REVERSED')` and
the enclosing transaction rolls back. The existing deferred storage checks
validate the history FK and the full line/redemption/slot relationship at COMMIT.
No schema, migration, grants, routes or shared registry change is needed.

The idempotent handler still contains the reversal: a same-key replay never runs
it. Cancellation after package expiry is permitted; a later redemption still
checks the visit date. Existing price-edit refusal remains. Performer replacement
uses the existing 055 checks and never writes package rows.

Session reload now hydrates redemption metadata in one bounded query on the same
transaction. Cancellation and performer events retain `{ entitlement_id,
component_id, ordinal }` and use the line's saved list price. Ordinary paid lines
continue emitting `package: null`. The response contract is unchanged.

Issue #843: both `resolvePackageRedemptions` catches now recheck authority only
for `SessionError`. Driver failures leave the use-case boundary unchanged,
without a query on the aborted transaction. The existing persistence layer still
sanitizes infrastructure failures as `SESSION_PERSISTENCE_FAILED`. The append
date assertion already followed the fresh authority read on this baseline;
existing RD-10 and added expired/not-yet-valid cases cover that ordering.

The new reversal error's bilingual response belongs to the existing
`packages/i18n/src/service-session-errors.ts` catalog, under the parent's explicit
scope extension after the initial handoff. The orders HTTP filter uses the common
lookup and always returns HTTP 409. No generated client was changed.

## Test coverage authored

- RC-01: real writer, HTTP route, shared history ID/time, unchanged money and
  package event metadata.
- RC-02: lowest freed ordinal reused, concurrent redeem/cancel conservation.
- RC-03: same-key replay after reuse, concurrent duplicate keys and different
  keys, finality after cancellation.
- RC-03b: owner-forced stale reversal and FREE slot; production triggers remain
  enabled during the actual cancellation and all effects roll back.
- RC-04: inherited tip guard and cross-company/business/branch refusal; existing
  054 permission, self, window and reason suites remain applicable.
- RC-05: cancellation after expiry, later redemption refused.
- RC-06: existing price refusal and no-op refusal retained.
- RC-06b: a deliberately incomplete cancel writer fails COMMIT. Existing
  `packages/db/src/__tests__/package-redemption-reversal.spec.ts` also covers
  reversal without freeing, wrong history, repeated reversal and slot reuse.
- RC-07: changed performers preserve redemption, slot, value and package event;
  cancellation then succeeds with the new revision.
- Rollback injected at slot release, status update, history insertion and event
  emission; retry succeeds after the transaction rolls back.
- #843: real PostgreSQL division error aborts each route's transaction; identity
  is asserted at the use-case boundary before existing persistence sanitization.
  No follow-up execute is attempted on that failed transaction.

## Parent validation commands (not executed by worker)

Review all changed production and test files before executing them. Use a private
test cluster: `docs/runbook.md`, section “Per-lane test Postgres”, and ADR-0006's
2026-10-21 addendum. The older runbook sentence about copying `.env` is not an
instruction for this task: never read or copy a real `.env`. The manager's 14:15
instruction authorizes a worktree-local file created only from `.env.example`,
with fresh random password, secret and key values. `git check-ignore .env`
confirmed that it is ignored. Only the test tooling loads that generated file.
The private Postgres lane is `44-cancel`; its port is 55405. A separate local
Redis container, `pospay-test-44-cancel-redis`, serves port 56344; API test commands
set `REDIS_URL=redis://127.0.0.1:56344` in the process environment.

```powershell
node scripts/test-db/lane.mjs up 44-cancel
pnpm --filter @pospay/api typecheck
pnpm --filter @pospay/api lint
pnpm lint:docs
pnpm module-map:check
pnpm --filter @pospay/api exec vitest run -c vitest.unit.config.ts src/modules/orders/domain/__tests__/line-cancel-event.spec.ts src/modules/orders/domain/__tests__/line-performers-event.spec.ts src/modules/orders/domain/__tests__/line-cancel-prepare.spec.ts src/modules/orders/domain/__tests__/line-performers-prepare.spec.ts
pnpm --filter @pospay/api exec vitest run src/modules/orders/__tests__/package-redemption-cancel.spec.ts src/modules/orders/__tests__/package-redemption-cancel-race.spec.ts src/modules/orders/__tests__/package-redemption-errors.spec.ts src/modules/orders/__tests__/package-redemption-guards.spec.ts src/modules/orders/__tests__/package-redemption-edge.spec.ts src/modules/orders/__tests__/package-redemption-write.spec.ts src/modules/orders/__tests__/session-errors.filter.spec.ts
pnpm --filter @pospay/api exec vitest run src/modules/orders/__tests__/service-session-line-cancel src/modules/orders/__tests__/service-session-line-performers
pnpm --filter @pospay/db exec vitest run src/__tests__/package-redemption-reversal.spec.ts src/__tests__/package-redemption-links.spec.ts src/__tests__/package-redemption-isolation.spec.ts
```

Parent also runs the three guards and independent Astra high review. Full suites,
builds and required exact-head CI/review receipts remain PR-owner responsibilities.
Worker ran no test, typecheck, lint, formatter, build, migration or lane command.
Read-only `git diff --check` produced no whitespace diagnostics at inspection.

## Changed files

All paths below are under `apps/api/src/modules/orders/`:

- `ports/line-cancel.port.ts`
- `domain/session-error.ts`
- `domain/line-cancel-event.ts`
- `domain/line-cancel-prepare.ts`
- `domain/line-performers-event.ts`
- `domain/line-performers-prepare.ts`
- `domain/__tests__/line-cancel-event.spec.ts`
- `domain/__tests__/line-performers-event.spec.ts`
- `use-cases/cancel-service-line/cancel-service-line.usecase.ts`
- `use-cases/change-line-performers/change-line-performers.usecase.ts`
- `use-cases/record-service-session/record-service-session.usecase.ts`
- `use-cases/record-service-session/record-package-redemptions.ts` (new; correction round)
- `use-cases/append-service-session-lines/append-service-session-lines.usecase.ts`
- `persistence/line-cancel-transactions.ts`
- `persistence/package-redemption-reversal.ts` (new)
- `persistence/session-records.ts`
- `http/session-errors.filter.ts`
- `__tests__/package-cancel.fixture.ts` (new)
- `__tests__/package-redemption-cancel.spec.ts` (new)
- `__tests__/package-redemption-cancel-race.spec.ts` (new)
- `__tests__/package-redemption-errors.spec.ts` (new)
- `__tests__/package-redemption-guards.spec.ts`
- `__tests__/session-errors.filter.spec.ts`

Authorized catalog scope extension: `packages/i18n/src/service-session-errors.ts`.

Row documentation: this handoff (new) and the pre-existing untracked
`44-dependency-refresh.md` (preserved without edits). No sales files, shared
registries, OpenAPI, module map, migration or package manifest was edited.

## Initial gate correction (parent execution)

The parent reported failed initial gates; implementation ownership stays with
this worker. Corrections replace the test's non-null assertion with `must`, move
the reversal messages into the authorized i18n catalog, document every new port
parameter, and replace positional reversal arguments with request objects.
The record route's package-resolution/authority-error handling is extracted into
`record-package-redemptions.ts` to reduce the `record` function without compressing
statements. Its `SessionError`-only catch preserves the same behavior. The append
route retains its own narrowed catch.
The parent also reported 32 unit tests passed and one failed: the new RC-07
event fixture supplied an empty `previous.performers` despite the contract's
minimum of one. It now uses the actual sample performers with their saved shares.
This is the parent's initial result, not a successful correction-run receipt.
The component lock returns its scoped redemption reference to the caller. After
the fresh authority check, reversal uses that reference without reading or locking
the component again. No stub or bypass replaces production behavior.
The parent reports lane `44-cancel` active on port `55405`; the worker does not
operate it or read the ignored local environment. Correction gates remain the
parent's responsibility and are not claimed passed here.
No command, test, formatter, build, Git operation or environment-file read was
performed by the worker in this correction round. Direct read tools were offline;
the edits used the existing source context and matching patch anchors. The pending
request for read-only shell access is no longer needed for these corrections.

After the owner explicitly allowed `Get-Content` only, the worker read back the
corrected record use case/helper, reversal adapter, port, transaction binding,
cancellation caller, i18n catalog, HTTP filter and affected test fixtures.
The source reflects the requested corrections; no further change was identified
by that read-back. No test, lint, typecheck, Git command or environment-file read
was performed. This source inspection does not establish a passing gate result.
