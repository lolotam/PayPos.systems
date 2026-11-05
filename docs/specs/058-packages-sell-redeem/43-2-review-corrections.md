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

### The lesson

The filter spec lives in `__tests__/`, which is the **integration** project; the unit project
covers only `domain/__tests__/`. Running the slice's own specs missed finding 2, so the whole
orders and tenancy integration suites run before every push.
