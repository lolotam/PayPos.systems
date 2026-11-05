# 43-2 — review corrections (PR #841)

Every round of the bots' findings and the one consolidated correction push that answers them
(PP-119.1). The plan (`plan-43-2.md` §14) carries the summary; this file carries the receipts.

## Round 1 — head `6e6ed627`

Receipts on the exact head, before the correction push:

| Reviewer | Receipt |
| --- | --- |
| Codex (`chatgpt-codex-connector`) | review comment at 2026-11-05T03:16:14Z, one P2 |
| CodeRabbit (`coderabbitai`) | review comment at 2026-11-05T03:23:01Z, two actionable comments |
| MergePilot panel (`mergepilot-review`) | review comment at 2026-11-05T03:36:16Z, six inline comments (one duplicate of Codex, one rejected by its own verifier) |
| CI (`CI` run 41960245401) | failed on `api:check · pos`; `ci-gate` failed in consequence |
| Socket Security | project report and pull request alerts: success |

### The findings and the fixes

1. **The expiry was checked against the raw client timestamp** (Codex P2, MergePilot high,
   CodeRabbit minor — the same defect three times).
   `sessionTime` clamps the visit to the server time with a 120 s device tolerance, so the
   instant the visit is saved with is not the instant the client sent. Near midnight a valid
   visit was refused with `PACKAGE_EXPIRED`.
   **Fix:** `visitInstant` (new, in `domain/session-time.ts`) normalises the instant before the
   expiry decision; the expiry is re-checked on the final instant by `assertPackageFactsAllowed`
   after the clock is read again. The provisional step never rejects a future timestamp — only
   the final `sessionTime` does — so the 120 s tolerance keeps its meaning.
   **Test:** `package-redemption-edge.spec.ts` — "validates the expiry on the normalized visit
   instant, not the raw client clock".

2. **The three package refusals answered 400 instead of 422** (CodeRabbit major, MergePilot
   medium).
   They fell through to the filter's `invalidStatus`, and the form controller opens the filter
   with 400.
   **Fix:** `PACKAGE_UNPROCESSABLE` in `session-errors.filter.ts`, beside the four sets the
   filter already carries.

3. **One query per package line** (MergePilot medium).
   A `SELECT … FOR UPDATE` per slot, an `INSERT` per redemption and an `UPDATE` per slot.
   **Fix:** `lockSlots` locks every chosen slot in one ordered statement, `writeRedemptions`
   inserts all the redemptions in one statement, and `markSlotsUsed` moves all the slots in one
   `UPDATE … FROM (VALUES …)`. The slot update returns the rows it moved; a count that does not
   match refuses the whole visit instead of leaving half a redemption.

4. **The new tenancy query had no result-shape test and no `EXPLAIN ANALYZE` assertion**
   (MergePilot medium, CLAUDE.md §9).
   **Fix:** `apps/api/src/modules/tenancy/queries/__tests__/package-sale-place.query.spec.ts` —
   the branch's own timezone, the business fallback, `null` for another company, an inactive
   branch and an unknown branch, plus the plan (the branch and business and company indexes, no
   sequential scan).

5. **The new module arrow had no ADR** (MergePilot medium, `docs/module-map.md` §1).
   **Fix:** the addendum of 2026-11-05 in ADR-0041 authorizes the named symbol read
   `tenancy.packageSalePlace` and the map row, and records why the branch's effective timezone is
   needed and which alternatives were rejected.

6. **The POS schema was stale** (CI).
   `apps/pos/src/shared/api/schema.d.ts` still had the old request shape after the lines became
   a union.
   **Fix:** regenerated from the OpenAPI file, like the admin one.

### Checked and not applicable

The panel raised that a reloaded package line loses its redemption identity
(`persistence/session-records.ts`). The panel's own verifier rejected the finding, and reading
the code confirms it: the only consumers of that identity — the edit, cancel and performer
guards of 43-1b — read `service_lines.redemption_id` from the row under the line lock, not the
domain marker. The marker is needed only on the lines the writer builds, and there it is set.

### Found by the local integration suite, not by a bot

The `20-line/80-performer` budget test in `service-session-readers.spec.ts` counts the statements
of a request. `SessionPlacePort.read` had started returning both timezones, so every visit paid
one more query — a paid visit was paying for a branch timezone that only a package draft needs.

**Fix:** the port keeps `read()` (the business timezone) and grows `branchTimezone()`, which the
record and append use cases call **only when the request carries a package draft**. A paid visit
pays the statement count it paid before the slice; a package visit pays the extra query it
actually needs.

### The lesson

The filter spec lives in `__tests__/`, which is the **integration** project; the unit project
covers only `domain/__tests__/`. Running the slice's own specs missed finding 2, so the whole
orders and tenancy integration suites run before every push.

## Round 3 — Astra's second read-only review (on the code as it stood)

Astra read the tree again and reported four P2 items. **All four were already fixed** in the
commits on the branch — the review had read a snapshot taken before those fixes — and each one
is checked against the code, not against the report:

| Astra's P2 | Where it is fixed | The code now |
| --- | --- | --- |
| The expiry uses a different instant than the persisted one | `record-service-session.usecase.ts` | `sessionTime(occurredAt, at, place.timezone)` runs **after** the locks, and the same `time.occurred_at` drives the package expiry, the performer eligibility and the saved visit. |
| The RLS tests chase an aborted transaction (`25P02`) | `package-redemption-rls.spec.ts` | Each forbidden statement runs in its own transaction through the `refuses` helper, so the real refusal code comes back. |
| The three package refusals answer 400, not 422 | `session-errors.filter.ts` | `PACKAGE_UNPROCESSABLE` maps them to 422 explicitly. |
| The generated clients still accept the paid line only | `apps/admin/src/shared/api/schema.d.ts`, `apps/pos/src/shared/api/schema.d.ts` | Both carry `lines: components["schemas"]["SessionLineDraft"][]`, regenerated from the OpenAPI file. |

Astra's remaining asks, and what happened to each:

| Astra's ask | Answer |
| --- | --- |
| The branch timezone across both routes | Covered: the record route measures the expiry in the branch's timezone, and the append route keeps the original visit's date and business timezone and uses the branch's timezone for the expiry only. |
| A membership or approval expiring during the component wait | The re-read after the last money lock is in the code, and the round-2 regression advances the injected clock across Kuwait midnight after the real slot lock and checks the persisted instant, the business date and the performer instant. |
| A mixed request with a partial discount refusal | Covered: the mixed-batch test keeps the request order and the ordinals and leaves the refused paid line with its input index. |
| A refusal without consumption | Covered: the request with one package line too many rolls the whole visit back, and the slot stays `FREE`. |
| **A failure after the redemption write, proving the line, the session, the outbox event and the idempotency key all roll back** | **Added in round 3**: `interceptDatabase` fails the slot `UPDATE` on purpose; the test then proves that no redemption, no line, no session, no outbox row and no idempotency row survives, that the slot is still `FREE`, and that the same key succeeds afterwards because the claim rolled back with the transaction. |
| The new tenancy reader needs a shape test and `EXPLAIN` | Done in round 1: `package-sale-place.query.spec.ts`. |
| Keep the slot lock and say why it repeats the component lock | The comment is on `lockSlots` in `persistence/package-redemption-writes.ts`: the component lock is the real serialisation point, the slot lock is the defensive check that makes "the lowest `FREE` session under a row lock" literal. |
| Record the manager's resolved decisions in §12 | Done: the plan's §12 carries the manager's verbatim answer beside Astra's. |

## Round 4 — the manager's findings on `16163c58`

The manager reviewed the head and found four things. All four are fixed.

| Finding | Fix |
| --- | --- |
| **MEDIUM** — the branch timezone was still read **before** `resolvePackageRedemptions` and its lock wait, in both use cases. A lock wait can outlive a reading taken before it, so the expiry was decided on a stale timezone. | The read moved **after** the redemption locks: the record route reads it after `resolvePackageRedemptions` and before the clock is read again; the append route reads it after the same call and before it checks the expiry against the original visit's date. The branch timezone is therefore always the one that was current when the decision was taken. |
| **LOW** — an encoding corruption in `ports/package-redemption.port.ts`: the `@param requests` line had become `???`. | Rewritten in Arabic: `@param requests المكوّنات والمطلوب من كل واحد، بالترتيب`. |
| **LOW** — the ADR-0041 wording about `read()` was still the old one. | The addendum now says that `read()` keeps the business timezone and `branchTimezone()` is a second, separate read, taken only for a package draft and only after the locks; the §1 port table names the new symbol read. The `## Addendum 2026-11-01 — SS-Q1b` heading, which the addendum had swallowed, is restored. |
| **NEW** — two Arabic lines in this file had become `???` (they were written through a PowerShell pipe with the wrong encoding). | The manager's verbatim decision is restored as UTF-8, and the whole diff is swept for `\?{4,}` before every push. |

## Round 2 — prepared against head `12c7b6d9`

The final clock reading after component and slot locks now supplies omitted
`occurred_at`. Package validity and performer eligibility both use
`time.occurred_at`, the exact instant persisted in the visit. No provisional
validity check can reject an instant before the final normalization.

Free slots for every locked component are read in one scoped VALUES/LATERAL
statement, bounded by the requested count per component and ordered by ordinal.
Component locks and the deliberate slot row locks remain in the transaction.

The regression in `package-redemption-edge.spec.ts` advances the injected clock
across Kuwait midnight after the actual slot lock and checks the saved occurrence,
business date and performer lookup instant. Local verification results and review
receipts must be recorded before publication. Codex was requested on the current
head; the MergePilot receipt is partial, so this round is not ready to push.

Local receipt for the prepared round: API `typecheck` passed; API `lint`
(including boundaries) passed after fixing the batch parameter's JSDoc;
`lint:docs` passed with 0 errors and 29 existing warnings;
`module-map:check` passed. The three package redemption integration/RLS files
passed, 23 tests, 233.27 s. The initial lint failure was solely the stale
`component_id/count` JSDoc parameter names after introducing `requests`.

Replied to and resolved the three still-open round-1 threads for 422 mapping,
query shape/EXPLAIN coverage, and ADR coverage, each citing `12c7b6d9`.
The clock and batching threads stay open until the consolidated correction is
published and validated. The manager was notified of the missing panel
verification receipt; no correction push or merge is claimed.

Manager decision, 2026-11-05, project conversation (verbatim):

«من المدير: مش هنعيد تشغيل MergePilot على 12c7b6d9. ادفع الجولة 2 دلوقتي في push واحدة.

السبب: إيصال 12c7b6d9 أعتبره مكتمل لـ PP-119.1. البوتات الأربعة في الجدول ✅ completed، بما فيهم Waleed_Bot اللي كمّل على fallback، والناقص هو خطوة الـ verification بس، ولقيت نفس النقطتين اللي لقيتهم باقي البوتات. Codex خلص على نفس الـ head ومالقاش مشاكل (06:5x)، وCodeRabbit موجود. لو أعدنا التشغيل على head إنت ناوي تستبدله، هنستنى حوالي 20 دقيقة على الفاضي، وده ضد قاعدة «ماتأجلش الشغل الجاهز».»

This decision supersedes the pending-panel statement above. Publish round 2 of 5
once, request Codex on the new head, and resolve clock/batch threads with commit
and regression evidence. No merge is authorized.

## Round 5 — MergePilot's review on `eb48cfc3`

MergePilot reviewed the round-4 head (`eb48cfc3`) and left three MEDIUM findings.
Codex reviewed the same head with no findings, and `ci-gate` passed on it.

| Finding | Fix |
| --- | --- |
| **MEDIUM** — the package outcome could escape before the fresh authority check: `resolvePackageRedemptions` waits on the component lock and can then throw `PACKAGE_NO_FREE_SESSION`, so a caller whose membership lapsed during the wait learned package state instead of `FORBIDDEN`. | Both use cases now catch the package failure and re-check the branch and the recorder on a fresh clock reading before the error leaves. The new `assertRecorderAuthorizedAfterLock` does that check, and the original package error is re-thrown only when the authority still stands. |
| **MEDIUM** — the resolver's documentation claimed it rejects an expired or not-yet-sold package and described a date and an instant input, while the function only locks and selects slots; validity is checked later by `assertPackageFactsAllowed` (CLAUDE.md §3.1). | The JSDoc now states that the function only resolves locked slots and that validity is measured on the final visit instant by `assertPackageFactsAllowed`; the `@param input` no longer mentions a date or an instant. |
| **MEDIUM** — the use-case layer counted the slots required per component, against the rule that a use case holds no arithmetic (CLAUDE.md §4.2). | The counting moved to `countPackageSlots` in `domain/package-redemption.ts`, as a pure function with its own unit test. |

**Tests.** `package-redemption-edge.spec.ts` — "RD-09 does not leak the package state to
a recorder whose membership lapsed during the lock wait": the clock advances past the
membership's end inside the component lock, the package has no free session, and the
request must fail with `FORBIDDEN` and write no redemption. Removing the re-check makes
that test fail with `PACKAGE_NO_FREE_SESSION`, so it pins the defect.
`domain/__tests__/package-redemption.spec.ts` — "the slot count per component is the
number of drafts that ask for it".

**Also in this round.** The corrupted em-dash in the Round 2 heading above is repaired
(`## Round 2 — prepared against head`), bundled here as the manager allowed.

## Round 6 — Codex's P2 on `7c3c86f4`

Codex reviewed the round-5 head and raised one P2: in the append route the package
validity was still checked before the post-lock authority check, so a caller whose
membership lapsed during the component-lock wait could still learn the package state
(`PACKAGE_EXPIRED` or `PACKAGE_NOT_YET_VALID`) instead of `FORBIDDEN`. The catch around
`resolvePackageRedemptions` did not cover that validation.

**Fix.** The append route now mirrors the record route: the branch timezone is read
after the redemption locks, the fresh authority check runs next, and the package
validity is measured after it. The package state therefore only leaves the route when
the authority still stands.

**Test.** `package-redemption-edge.spec.ts` — "RD-10 does not leak the package validity
to an appender whose membership lapsed during the lock wait": the clock advances past
the membership end inside the component lock, the package is expired on the original
visit's date, and the append must fail with `FORBIDDEN` and write no redemption.
Restoring the old order makes that test fail with `PACKAGE_EXPIRED`.

This round exceeds the five-round budget agreed with the manager. It was published
because the merge gate requires a clean Codex on the exact head, and the P2 is a real
disclosure of package state to an unauthorized caller. It is the last push on this PR.

