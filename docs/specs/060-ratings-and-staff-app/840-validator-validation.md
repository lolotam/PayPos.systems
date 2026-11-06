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

## Correction round 3 of 3 — manager disposition and bounded writer guards

The manager's decision is recorded verbatim before implementation:

> قرار المدير على r4492536289: بعد قراءة issue840 ونص spec الحالي وADR0010 §§7–8 وإيصال PP136، أقبل الحكم: المشاهدة صحيحة كسلوك decoder، لكنها ليست مخالفة مثبتة لعقد فحص snapshot في #840. انشر ردًا بالأدلة ومراجع العقد والـ raw probe، ثم resolve للـthread مع read-back وتسجيل هذا القرار حرفيًا في audit. التصرف رفض finding لعدم انطباق العقد، وليس accepted deferral أو waiver؛ لا تدّعِ انعدام الأثر الأمني المطلق أو أن حلًا واحدًا حصريًا مطلوب. لا تعديل docs لتضييق الضمان، ولا issue جديد أو decoder/codec/wire تعديل ضمن هذه المهمة. #887 يبقى منفصلًا OPEN. نفّذ الآن خطة R3/3 المحدودة لحارسي integer durations وnonempty sweepId/pageId مع إثبات الرفض قبل Redis/قبل mutation والـpositive controls؛ حافظ على ConfigError والسياسات الحالية بلا rounding. بعد الفحوص والمراجعة المطلوبة دفعة واحدة فقط، ردود/إغلاق CodeRabbit بالأدلة، وأرسل SHA. CI أخضر على44c03 لكنه لا يحتسب للرأس القادم؛ لا merge أو activation. أي عيب إضافي بعد R3 ارفعه قبل تجاوز السقف.

This records the disposition without changing the existing snapshot contract or decoder.
The private raw-literal probe used identical input bytes on baseline `dd7c42ba` and
`44c03dc7`: duplicate request-ID members and duplicate `ticket` fields both decode to the
last value. `read` returns OK without a write; `renew` returns OK and re-encodes, as it also
does for the valid single-member control. The approved disposition rests on the written
snapshot contract, not baseline parity alone. The five approved writers encode Lua tables;
their inability to emit duplicate member names is supporting evidence, not a blanket
exception. No absolute security-impact or exclusive-solution claim is made.

CodeRabbit's two bounded findings are separately reproduced with the real adapter:
fractional lease/backoff/turn durations can write timestamps the next validator rejects,
and empty/missing sweep/page IDs can be written OK before a subsequent CORRUPT. The new
input regressions require configuration rejection before Redis, ID rejection with LIMIT
before any persisted mutation, unchanged bytes, and valid integer/nonempty-ID controls.
No numeric precision workaround or retry-map representation change is included.

The new input suite was RED **17/19** before the guards; both positive controls passed.
After the bounded guards, **331/331 tests in five files passed**. The three fractional
options raise the existing `RatingClaimStateConfigError` class before Redis execution;
passthrough spies on the real client's eval/evalsha boundary observe zero calls, and
existing bytes remain unchanged. The fourteen raw sweep envelopes cover missing, null,
empty and non-string IDs in both actions, returning LIMIT/original version and preserving
bytes plus readable valid state. Positive controls execute integer-duration acquisition,
retry allocation/reservation, zero backoff and nonempty sweep/page writes.

No duration is rounded, and the existing lease-versus-turn and zero-backoff policies
are retained. The guards add no decoder, codec, configuration-file or activation change.
The raw-duplicate disposition reply is
[4492687894](https://github.com/lolotam/PayPos.systems/pull/888#discussion_r4492687894),
resolved only after the manager's decision and reply read-back.

The manager also confirmed the retry representation verbatim:

> retries map بمفاتيح requestId يظل العقد، لا تحويل بروتوكول.

ADR-0010's request-ID-keyed retry lane and `ClaimStateSnapshot.retries` remain the source
contract. CodeRabbit's linked-issue warning does not authorize changing that representation.
The source/decision response is
[6685486886](https://github.com/lolotam/PayPos.systems/pull/888#issuecomment-6685486886).

Round-3 worker typecheck, scoped ESLint/boundaries, module-map, documentation (zero errors /
29 existing warnings), formatting and diff checks passed. Clean-code, test and documentation
guards were applied. Fresh internal review remains required. Heavy suites remain CI-only.
The single R3 push exhausts the three-round correction budget; additional findings must
be reported before any further implementation, with no implicit fourth round.


## #888 — استثناء رابع محدود بعد استنفاد 3/3

**السؤال حرفيًا:**

> قرار #888 — استُنفد سقف 3/3 وبقيت مجموعتان P2 مثبتتان: كتابة timestamp يتجاوز المجال الآمن، وكتابة upperId فارغ تفسد الحالة. هل نعتمد متابعتين موثقتين، كلتاهما مانع تفعيل، مع السماح بدمج #888 فقط بعد تحديثه إلى main الجديد وإكمال CI والمراجعات والـbackup؟ هذا مسار تأجيل معلن وفق سياسة العيوب الأقل من P1؛ ليس تفعيلًا ولا إغلاقًا للعيبين، و#887 يبقى مستقلًا. البديل: استثناء رابع واحد لإصلاح المجموعتين داخل #888 عبر التحقق قبل تخزين الحالة، مع الاختبارات وقياس الكلفة؛ دون تغيير سياسة صفر/سالب المدد أو decoder/codec.

**الاختيارات حرفيًا:**

1. «أعتمد المتابعتين كمانعي تفعيل (الموصى به)»
2. «أعتمد جولة رابعة محدودة لإصلاحهما قبل الدمج»
3. «أبقِ #888 متوقفًا دون دفعة إضافية»

**إجابة وليد حرفيًا:** «أعتمد جولة رابعة محدودة لإصلاحهما قبل الدمج».

**القناة والتاريخ:** قرار وليد المباشر، منقول من مدير PosPay في تكليف هذه الجلسة، 2026-11-06.

**السجل والحدود:** 3/3 مستنفدة + استثناء رابع محدود منفصل، دون reset. التنفيذ داخل PR #888: pre-encoding validate_state في store الخمسة، الاختبارات وقياس الكلفة ثم CI والمراجعات على الرأس الناتج. لا تغيير لسياسة صفر/سالب المدد أو decoder/codec/wire أو #887، ولا issues تأجيل للمجموعتين. لا merge أو activation. المدير ينسق Codex واحدًا على الرأس الناتج، وأي finding خارج النطاق يُرفع قبل تجاوزه.

### Bounded exception implementation and evidence

The five Lua `store()` functions now apply the existing `validate_state` predicate to
the selected in-memory state before `cjson.encode` or `SET`. Every existing call site
already maps a refused store to `LIMIT` using its saved original version; fresh acquisition
uses version 0. The incremented local version and other local changes are discarded without
a Redis write. This also refuses an empty stored upper bound through the same predicate.
No second upper-bound guard, duration sign rule, operational ceiling, rounding, decoder,
codec or wire change was added. Issue #887 remains separate and OPEN: pre-encoding
validation does not establish numeric round-trip safety through cjson.

The five comments represent two groups: derived timestamps
`4492801111` / `4492802077` / `4492809400`, and empty upper bounds
`4492803307` / `4492809413`. The new real-Redis write-contract suite was RED with **7
failures and 14 passing controls** on the updated base before adding the store check.
After the five-line production patch, **352/352 tests in six files passed** in 9.19s,
including all original 331 assertions. Refused fresh acquisition leaves no key; takeover,
renewal, reservation and both retry-settlement paths preserve exact bytes, original
versions and usable old fences/tokens. Stale incarnation/version and foreign owner checks,
plus an already active sweep, retain their existing precedence.

Controls preserve zero backoff, zero/negative lease/turn and negative-backoff semantics,
MAX turn with an ordinary lease, MAX backoff with a representable future due date, and
null/omitted/UUID upper bounds. Byte-overflow rollback discards an unadmitted unsafe retry
before a valid OVERFLOW write, rolls back nextTicket and remains readable. Capacity
overflow likewise does not reject an unused backoff. The diagnostic tradeoff is explicit:
a would-write-invalid timestamp now produces the existing LIMIT_REACHED path, rather than
writing a key that the next load treats as corrupt/fence-lost; no extra diagnostics were
added in this exception.

Main was fetched and verified as `572a10627d006b50909cd254af51e167de2c7e69`, then merged
without rebase or force. The original four implementation/correction commits remain
unchanged in the saved range-diff. The retained pre-exception ref is
`backup/840-before-exception-1620b8bb-20261106`; the verified incremental Git bundle,
binary patch, range-diff and test logs are under
`F:/Dev/Temp/pospay-840-validation/`. This is source-history backup evidence, not a database
backup or verified restore receipt. All deployment/merge backup gates remain outstanding.

### Measured scan cost

The reproducible [benchmark](840-store-scan-benchmark.mjs) uses only synthetic state on a
private local Redis. With dependencies installed and Node 24, run it from the repository:

```powershell
node docs/specs/060-ratings-and-staff-app/840-store-scan-benchmark.mjs redis://127.0.0.1:56382 <report-output.json>
```

The port must belong to the caller's private Redis test container. It creates random
benchmark keys and deletes only those keys. Each timed EVALSHA starts with identical
bytes reset outside timing. The script asserts that the current lease script minus the
new store guard equals the reviewed `1620b8bb` baseline. It alternates order across 10
warmup pairs and 100 measured pairs per shape. A separate 20-batch, 25-iteration scan
measurement uses Redis commandstats EVALSHA microseconds, subtracting the same script's
decode/prevalidation/no-op cost; each interval asserts exactly one EVALSHA. An initial
Redis TIME-in-script experiment returned zero elapsed time and was discarded.

The [retained measurement](840-store-scan-measurement.json) used Node v24.21.0 and private
Redis 7.4.11 on Docker/WSL2 (client round-trip includes transport/reply):

| State shape | JSON bytes | Baseline median / p95 ms | Checked median / p95 ms | Paired delta median / p95 ms | Added scan median / p95 µs |
| --- | ---: | ---: | ---: | ---: | ---: |
| Empty IDLE | 347 | 1.447 / 3.882 | 1.475 / 3.951 | 0.008 / 2.493 | 6.16 / 7.88 |
| 64 retries, 25 journal entries, 25 reserved | 11644 | 2.493 / 5.743 | 2.761 / 6.392 | 0.220 / 2.702 | 193.00 / 266.44 |
| 2048 retries, 75 journal entries, 25 reserved | 178564 | 15.626 / 25.000 | 18.391 / 31.294 | 2.353 / 11.182 | 1776.16 / 2287.36 |

The added scan is measurable at the default retry capacity. Host/transport variance is
visible in round-trip tails; these local samples do not establish production p95/p99,
throughput, or a latency guarantee. No concurrency, budgets or per-company metrics change
is inferred from this measurement. Exact-head CI, fresh independent review and manager
coordinated external receipts remain required after the single consolidated push.

The exception's local gates passed: worker typecheck, scoped ESLint/boundaries (existing
boundary-rule deprecation warnings only), module-map, documentation (0 errors / 29
existing warnings), formatting and diff checks. Clean-code, test and documentation guard
passes retained the minimal five-line production change, real persistence assertions and
source-backed claims. The owner card's UTF-8 question, all three options and answer were
compared exactly in both this audit and `owner-questions.ar.md`. Heavy suites remain
CI-only. The manager owns merge and the one final-head Codex request.
