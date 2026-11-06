# Issue #840 — rating-claim Lua validation

## Scope and start

The manager assigned issue [#840](https://github.com/lolotam/PayPos.systems/issues/840) after
PR #785 merged. The existing session resumed from current `origin/main`
`dd7c42baaa04b5cb0df5fde03cb739ffde7e9e78`, on branch
`fix/840-rating-claim-state-validation`, after verifying a clean worktree and no duplicate
open PR or task session for #840. No migration, scheduler activation, configuration change
or deployment is included. The manager owns the merge. The completed #785 correction
budget remains exhausted; this separately assigned issue follows the current delivery
pipeline and does not reopen #785.

The initial implementation changes the shared stored-state validator. Every Redis command
already embeds it and invokes it before fence checks or writes. Correction round 1 also
guards the existing overflow writer and rejects duplicate journal tokens at enrollment.
Existing corruption tests and their assertions remain; the shared test helper checks all
ten commands and the stored bytes after each command.

## Contract and design evidence

- Original finding [r4475811730](https://github.com/lolotam/PayPos.systems/pull/785#discussion_r4475811730)
  explicitly requests contiguous numeric keys for page entries and string request IDs for
  retries. ADR-0010 and `ClaimStateSnapshot` agree: `page.entries` is a sequence, while
  `retries` is a request-id-keyed map. The issue's array wording does not authorize a new
  retry wire format. Numeric-keyed nonempty retry arrays are refused; empty collections
  remain compatible with Redis cjson's empty-table representation.
- Required version/ticket counters are positive safe integers; the required overflow
  counter is a nonnegative safe integer. Required flags are booleans. Optional strings,
  timestamps and the historical optional `sweepOverflowCount` are checked when present.
  The latter retains the existing missing-means-zero behavior in `settle` and `finish`.
- Top-level owner/lease/turn-start and retry owner/lease/work-token fields form complete
  groups. Retry reservations may survive top-level release; no equality with the current
  owner's fields is imposed. Past lease timestamps remain valid expired leases.
- IDLE excludes active sweep/page fields; SWEEP requires its sweep ID. A page belongs to
  that sweep, and a cursor/nonempty page requires a captured upper bound. Drained pages
  preserve their cursor metadata and remain valid.
- The PP-136 `pospay-advisor` consultation agreed with preserving the map and empty-table
  compatibility and advised retaining the optional sweep-overflow fallback. Its completed
  receipt is in the original delegated thread:
  <t3-thread://v2/438824e0-fe19-4a22-bb31-f81eff7b7322/thread:delegated-task:command%3Amcp%3Aa7b82cbc-8a41-4641-86b6-948b98a1474c%3Adelegate-task%3Ad7e60b58-a631-437d-954d-ce57ef44ea79>.
  Astra also supplied read-only design advice about release, takeover and partially
  drained pages; that advice explicitly reported incomplete governing-document coverage
  and is not counted as the required independent code review.

## Local verification

Real Redis 7 ran only in the worktree-labelled `pospay-840-redis` container on
`127.0.0.1:56382`. No shared/staging Redis or database was used. An external temporary
Vitest configuration selected only the Redis persistence specs without the unrelated
Postgres global setup; no repository runner configuration was changed.

- Before the fix, the nine `overflowCount` corruption variants failed: the original
  validator returned BUSY instead of CORRUPT. These were genuine failing assertions.
- After the fix, **286 tests in three files passed**: corruption contracts, the existing
  Redis state lifecycle suite, and the existing byte-cap settlement regression.
  Corruption coverage checks missing/null/wrong-type/non-finite/out-of-range counters,
  booleans, phase fields, ownership groups, sparse/object/mixed/null-bearing page entries
  and malformed retry maps/records. Rejections preserve bytes after each command.
- Positive controls cover empty collections, historical absent sweep-overflow counters,
  drained pages, released reservations, takeover, expired ownership and the existing
  raw-Lua version-cap LIMIT result.
- Worker typecheck passed after rebuilding workspace dependencies with
  `pnpm --filter '@pospay/worker^...' build`. Its first invocation failed on stale built
  exports from newer main packages; no source workaround was made.
- Scoped ESLint/boundaries passed. The initial test fixture used dynamic `delete`, which
  the existing lint rule refused; it was replaced with `Reflect.deleteProperty`.
- `pnpm module-map:check` passed; `pnpm lint:docs` passed with zero errors and 29 existing
  TODO warnings. Scoped Prettier and `git diff --check` passed.
- Clean-code, test and documentation guard passes preserve real Redis execution,
  parameterized corruptions, observable reply/byte assertions and the existing tests.
  Heavy suites remain CI-only. These local results do not claim exact-head CI or bot
  review completion.

## Separate pre-existing numeric reply issue

An exploratory boundary test found that Redis cjson rounds a reply version of
`Number.MAX_SAFE_INTEGER`: Lua returns
`{"version":9.007199254741e+15,"code":"LIMIT"}`, and the TypeScript codec raises
`RATING_CLAIM_STATE_REPLY_INVALID`. The stored bytes remain unchanged. A separate private
Redis probe reproduced the same result with the untouched main validator and this fix.
The committed Lua contract test verifies LIMIT and unchanged bytes; it does not claim
that the TypeScript numeric reply boundary is repaired.

The evidence is recorded in [#887](https://github.com/lolotam/PayPos.systems/issues/887),
and was reported to the manager for disposition. It is not an accepted deferral, a waiver
or permission to change the numeric wire protocol in #840.

## Remaining delivery gates

Independent internal review and the final exact-head CI/Codex/four-panel receipts must be
recorded before merge. Current pipeline PP-131.2 permits at most three code correction
rounds, with one consolidated push after all four panel bots finish each intermediate
head; Codex runs once on the expected final head. P2/P3 findings are fixed by default
within those rounds. Missing or partial receipts are assessed under the actual pipeline
exceptions, never assumed complete.

Issue #840 must land before any scheduler activation issue closes. The seven issues
#803/#804/#805/#808/#809/#810/#811 remain open and this PR does not activate
`createRatingClaimsRuntime`. No merge or deployment is performed by this session.

## Correction round 1 of 3

The manager authorized one consolidated correction push after the four panel bots completed
on `9228e3381f8d8558a9cd7e222409d93f2a001f71`. The full receipt is
[5799755861](https://github.com/lolotam/PayPos.systems/pull/888#pullrequestreview-5799755861).
The automatic Codex review also completed without findings on that head; it was not requested
again. That receipt does not substitute for the resulting head's review requirements.

All four findings are accepted, with the page-progress suggestion adjusted to the actual
writer contract:

| Finding | Correction and compatibility evidence |
| --- | --- |
| [4492160826](https://github.com/lolotam/PayPos.systems/pull/888#discussion_r4492160826) | Validate cursor/page presence, matching through-ID, order and bounds. `settlePage` removes arbitrary entries without moving the cursor; a settled tail or drained page must stay valid. Do not require the final remaining entry to equal the cursor. |
| [4492160834](https://github.com/lolotam/PayPos.systems/pull/888#discussion_r4492160834) | Reject duplicate stored work tokens as CORRUPT, and reject their enrollment with LIMIT before any write so the writer cannot create a state the validator refuses. |
| [4492160844](https://github.com/lolotam/PayPos.systems/pull/888#discussion_r4492160844) | Positive sweep overflow requires reconciliation. `begin` resets the sweep counter, while `finish` may clear the flag after a clean sweep despite historical cumulative overflow; the cumulative total is not coupled to the flag. Missing historical sweep counts still mean zero. |
| [4492160858](https://github.com/lolotam/PayPos.systems/pull/888#discussion_r4492160858) | Both capacity overflow and encoded-byte fallback refuse an increment at either counter's MAX_SAFE boundary, returning LIMIT with the original version and leaving the stored bytes unchanged. |

Writer inspection covered acquire, lease, reserve, sweep and settle. Only enrollment creates
the journal/cursor pair; settlement removes journal entries but preserves that progress.
Release and takeover retain the existing reservation semantics. No new protocol, codec,
migration or activation behavior is introduced. The PP-136 Fable advisor agreed with these
invariants and added the enrollment guard and representable numeric-control requirement:
<t3-thread://v2/438824e0-fe19-4a22-bb31-f81eff7b7322/thread:delegated-task:command%3Amcp%3Aa7b82cbc-8a41-4641-86b6-948b98a1474c%3Adelegate-task%3A0163a4bf-62cd-45e0-8075-3f7da95ec0b3>.
These small review corrections were implemented directly under the runtime orchestration
instruction to fix small findings without delegating their implementation.

The new real-Redis regression suite first failed **17 of 22 tests** against the original
head; five positive controls passed. After the correction, **308 tests in four files passed**,
including the unchanged existing assertions. Twelve stored-state mutations exercise all ten
commands and byte preservation, one enrollment regression verifies LIMIT without a write,
four counter-cap regressions cover both counters and both overflow paths, and five controls
cover tail settlement, draining, an empty first page, historical overflow and representable
large increments. The dedicated worktree-labelled Redis container is `pospay-840-r1-redis`,
bound only to `127.0.0.1:56382`; no staging access was used.

Issue #887 remains separate and open. MAX_SAFE cases use an exact raw input, a small original
version, and LIMIT/byte assertions; they do not call a subsequent writing operation or claim
that cjson can round-trip the large counter. Positive increment controls use
`99999999999998` to `99999999999999` (14 significant digits), rather than MAX_SAFE minus one.
No precision setting or wire/codec workaround is included.

Round-1 local gates passed: worker typecheck; scoped ESLint and boundary rules;
`pnpm module-map:check`; `pnpm lint:docs` (zero errors, the same 29 existing warnings);
scoped Prettier and `git diff --check`. Clean-code, test and documentation guards were
applied to the delta. The shared Redis test harness has two spec consumers and preserves
the previous ten-command assertions. Heavy suites remain CI-only. Independent review and
fresh external exact-head receipts remain required after these checks.

## Correction round 2 of 3

The manager authorized checking [4492379715](https://github.com/lolotam/PayPos.systems/pull/888#discussion_r4492379715)
on `a3a7d85e6f8868f1c531469cd65e1fa7a8d3fd30`, with no push until all four panel
bots completed. All four have now published their exact-head receipts; the only new
published finding concerns retry ticket ordering. Codex also completed clean on that head:
[6684778549](https://github.com/lolotam/PayPos.systems/pull/888#issuecomment-6684778549).
No duplicate request is authorized or needed for that head.

Before changing production code, three real-Redis regressions failed: a ticket equal to
`nextTicket`, a ticket above it, and duplicate tickets below it. Each expects CORRUPT and
unchanged bytes through the existing ten-command helper. This records a failing
reproduction, not a passing byte-preservation claim for the old implementation.

Source inspection found only two ticket allocators, both in `settle`: a new page retry
or a retry requeue takes the current `nextTicket` and advances it. Byte-overflow rollback
removes the unadmitted entry before restoring the counter. Fresh acquisition starts an
empty map at ticket one; release, takeover, reservation, begin and finish do not renumber
retained retries. The original phase-1 writer at `005a3b37a` and the merged #785 writer at
`13deaa947` use the same allocation rule. The reservation tie-breaker handles equal values
deterministically but no inspected writer intentionally creates equal tickets. Sparse
ticket values and arbitrary map iteration order remain valid; a positive compatibility
test covers both, including the historical optional sweep counter.

The completed PP-136 Fable advisor approved both invariants and retaining gaps, iteration
independence and the historical sweep-counter fallback. The advisor confirmed both
historical writers and the rollback semantics; no owner/protocol decision is needed.
Receipt:
<t3-thread://v2/438824e0-fe19-4a22-bb31-f81eff7b7322/thread:delegated-task:command%3Amcp%3Aa7b82cbc-8a41-4641-86b6-948b98a1474c%3Adelegate-task%3A2154d9b9-f506-4984-91f9-609d488c9daf>.

The shared validator now checks each ticket is strictly below the already-validated
`nextTicket` and uses a seen-ticket set to refuse duplicates. The Arabic header and spec
record this contract. The existing reservation comparator is unchanged. No wire/codec
changes, migration, activation or #887 repair are included.

After the patch, **312 tests in four files passed**. The three new rejection cases now
exercise all ten commands and preserve the raw bytes after every command. The sparse
ticket positive control passed before the patch and in the final suite. Existing
allocation/requeue, release/takeover and drained-page assertions are retained. The
existing encoded-byte overflow control in `rating-claim-state-invariants.spec.ts` already
performs a successful `read()` after rollback, so no duplicate regression was added.

Source inspection also found the lease acceptance test's foreign-owner seeder assigned a
hard-coded ticket 999 without advancing the queue counter. It now allocates from
`nextTicket` and advances it, matching the real writer. The foreign owner/lease data and
all assertions are retained. That database-backed acceptance suite stays CI-only; it is
not included in the 312 local Redis-only test count.

CI on the pre-correction head `a3a7d85e` completed successfully:
[42217057253](https://github.com/lolotam/PayPos.systems/actions/runs/42217057253),
11m49s from creation to final update. That result and the old review receipts do not
substitute for exact-head gates after the consolidated round-2 push.

Round-2 worker typecheck, scoped ESLint/boundaries (including the corrected lease seeder),
module-map, docs (zero errors / 29 existing warnings), Prettier and diff check passed.
Clean-code, test and documentation guards were applied. Fresh independent internal review
and new exact-head CI/five-review receipts remain required; the manager owns the merge.
