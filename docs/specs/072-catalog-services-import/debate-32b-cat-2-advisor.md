# Debate, 32b-cat-2: one round, `pospay-advisor` as the stand-in for Astra

The batch rule (PP-168) is one round with Codex `gpt-6-astra`, effort `medium`, read-only. The call on 2026-11-12 failed
with «You've hit your usage limit ... try again at Nov 14th, 2026 11:20 AM» (no output). The stand-in is the read-only
`pospay-advisor` (Claude Fable 5). **Its advice is non-binding**; the verdicts below are the orchestrator's. The
reviewer read the plan at its first draft (before the corrections of this round).

## Reviewer output (verbatim)

**Verdict: agree with changes.** No P0. Four P1s must be fixed in the plan before any brief goes out; two of them need an owner decision first.

1. **P1 — 200 ms gate skipped (plan "Design advisors", Risk 1; `spec.md:587-593`).**
   - The spec requires a warm close and reopen of 1,000 services measured against 200 ms, and a worker-or-synchronous decision before this PR. The plan tests 500, asserts no wall-clock limit, and defers the decision.
   - Citing PP-165 is wrong: PP-165.1 keeps §6 budgets that have no baseline (CLAUDE.md §9).
   - 500 is the import file cap, not a category cap; a category is unbounded.
   - The plan also swaps the spec's `INSERT … SELECT` audit for app-side `appendAuditLogs` (`packages/db/src/audit-log.ts:43`), which serialises and redacts about 2,000 snapshots in Node. This is not stated as a deviation.
   - Done: a 1,000-service warm measurement against 200 ms, the worker-or-synchronous decision recorded, and the audit-path deviation written into the spec. If it does not fit, stop and ask Waleed, as the spec says.
2. **P1 — C-6 restart inverts the lock order.**
   - Attempt 1 holds the service `FOR UPDATE`. "Release nothing and restart" then locks the new category B `FOR SHARE` while still holding the service.
   - A close of B holds B `FOR UPDATE` and waits on that service: a deadlock (40P01 after `deadlock_timeout`).
   - The claim that update-service "already implements the loop" is false: `update-service.usecase.ts:43-44` throws `SERVICE_REVISION_CONFLICT`.
   - Done: retry in a new transaction after rollback, or throw as update-service does. Add a test for a move to B racing a close of B and a single close.
3. **P1 — SI-Q27 ships a guessed money rule (C-9, plan line 14).**
   - Line 14 says nothing PENDING blocks the row, yet C-9 refuses redemption of prepaid package sessions. `record-service-session.usecase.ts:52` reads every line, from-package lines included.
   - SI-Q28 compounds it: `readPackageTypeForSale` still sells a package the customer cannot then redeem.
   - A third package path is in neither question: the worker package import matches and commits onto closed services (`apps/worker/src/modules/catalog/persistence/package-import-services.reader.ts:7`, `package-commit-services.reader.ts:15`).
   - Done: the owners' answers before the orders part merges, with SI-Q28 widened to cover package import. Otherwise the manager explicitly accepts the strict default; CLAUDE.md §11 forbids guessing.
4. **P1 — the size is more than twice the spec row.**
   - The plan totals about 1,010 lines of code plus 900 of tests. The spec row says 600 to 850 including tests (`spec.md:735`).
   - Done: split it. `@RequireAll` with its ADR and tests is a clean PR with no migration; the orders `SERVICE_CLOSED` part is a second candidate. The delivery table is amended.
5. **P2 — the cascade's `FOR UPDATE` blocks every FK insert on `services`.**
   - Inserts into `service_lines`, `discount_proposals`, `commission_lines`, `commission_service_overrides`, `package_type_components` and package storage (0131, 0162, 0196, 0200, 0202) take `FOR KEY SHARE`.
   - Any writer that inserts for two or more services without ascending pre-locks can deadlock with a 1,000-row cascade.
   - `FOR NO KEY UPDATE` still serialises with the recorder's `FOR SHARE` and no key column changes. It deviates from the spec's wording, so record it.
   - Done: either switch and note the deviation, or prove every FK writer pre-locks in ascending order.
6. **P2 — `closed_at` leaks into the package sale path.**
   - `mapService` spreads `...row` (`catalog-reader.adapter.ts:19`) and is reused at line 32 for `readPackageTypeForSale`.
   - Done: strip inside `mapService`, with a test that sale snapshots and fingerprints are byte-identical.
7. **P2 — C-1 contradicts itself.**
   - `serviceSnapshot` spreads the record and feeds both the audit and `serviceResponse` (`domain/service.ts:180-212`).
   - So the marker either leaks to HTTP or is missing from the audit.
   - Done: separate audit snapshot and response view, with a test that no response carries `closed_by_category_id`.
8. **P2 — package picker contradiction.** C-10 says `package-service-options` is unchanged. Tests line 94 says the "package picker leaves closed out". Done: delete the test line until SI-Q28 is answered.
9. **P2 — `SERVICE_CLOSED` is thrown from a persistence adapter with no `input_index` or `service_id`.** `SESSION_SERVICE_NOT_FOUND` carries both (`prepare-session-lines.ts:36`). Done: add details so the POS can name the line. The 409 status is the plan's own choice; record it in the spec.
10. **P2 — a broken marker CHECK would surface as a price error.** `checkViolation` maps any unknown CHECK to `SERVICE_PRICE_INVALID` (`drizzle-service-transactions.ts:120-132`). Done: `services_closed_marker_*` ends as a 500 (CLAUDE.md §5).
11. **P2 — `@RequireAll` gaps.**
    - `[].every` is true, so an empty list must throw.
    - Adding `mode: 'any'` to all metadata breaks the exact-shape assertions in `apps/api/src/shared/__tests__/require-any.spec.ts`.
    - Missing tests: a DENY on one of the two permissions gives 403, and a business-wide personal grant passes.
    - Done: all three covered, and `@RequiresFeature('catalog')` stated for the five routes.
12. **P3 — wrong file for the grants.** The services column grants live in `packages/db/test/catalog-grants.ts:3-13`, not `privileges.spec.ts`. The Files table omits it.
13. **P3 — caller list incomplete.** `apps/api/src/app.ts:173` also calls `readSessionServices` (the commission override existence check). List it and state that it is unchanged.
14. **P3 — decisions the spec does not state.**
    - The nested `{ category, services_closed }` response; the spec reads flat.
    - A closed service stays editable.
    - An ADR-0003 paragraph instead of the spec's ADR "numbered at merge".
    - Done: each one written into the spec.
15. **P3 — missing tests.**
    - Idempotent replay of a recording after a close.
    - An approved discount proposal whose service has since closed.
    - The `UPDATE` row count equals the locked count.
    - The cascade waiting behind a long worker `FOR SHARE` (package commit).

Risk 3 (the count race) holds; I found no hole in it.

Owner calls named by the reviewer: Waleed (technical) for the 200 ms and worker decision; both owners for SI-Q27 and SI-Q28 including package import; the manager for the split and the lock-strength deviation. Could not verify: `accessAt` internals, the worker FK insert order, the `ROLE_DEFAULTS`-to-seed parity test, the migration runner's transaction behaviour, POS offline recording.

## Verdicts

| # | Verdict | What changed |
|---|---|---|
| 1 | Accept | Plan C-4 and «Design advisors»: 1,000 services, warm, asserted under 200 ms; stop and report if it does not fit; the audit-path deviation is written down (the one-statement `appendAuditLogs`, because the snapshot must equal `serviceSnapshot`). PP-165 is no longer cited for this. The worker-or-synchronous decision is **not** invented here: it is Waleed's if the measurement fails. |
| 2 | Accept | C-6: throw `TRANSACTION_RETRY_REQUIRED` and roll back; the use case restarts in a new transaction (max 3). The false claim about update-service is removed. A racing test is added. |
| 3 | Partly accept | The rule applied is the one the spec writes (the reader refuses a closed service at record time, no carve-out). It is **not** a new rule, so the PR does not stop; but the money consequence (package redemption, package sale, package import) is escalated as SI-Q27 and SI-Q28 (PENDING), SI-Q28 is widened to the worker import, and the report asks the manager either to accept the strict default or to hold the orders commit until the owners answer. The orders part is its own commit so it can be held. |
| 4 | Accept | Plan size section: the overshoot is stated, the work is committed in five separable commits so the manager can split without rework. The delivery table is not amended by me (manager's call). |
| 5 | Accept | C-3: `FOR NO KEY UPDATE` for the cascade, deviation recorded in the spec. |
| 6 | Accept | The adapter's `mapService` drops `closed_at`; test added. |
| 7 | Accept | C-1: `serviceSnapshot` (audit) carries the marker, `serviceResponse` drops it; test added. |
| 8 | Accept | Test line removed. |
| 9 | Partly accept | `service_id` is carried; `input_index` is not available inside the adapter and is not forced (the domain would need to know about closing). 409 is recorded in the spec. |
| 10 | Accept | `services_closed_marker_*` propagates as an unknown error (a 500). |
| 11 | Accept | Empty list throws, shape assertions updated, DENY and business-wide grant tests, `@RequiresFeature('catalog')` on the five routes. |
| 12 | Accept | The grants file is `packages/db/test/catalog-grants.ts` (already the brief's file); `privileges.spec.ts` is touched only if it lists the services grants. |
| 13 | Accept | Listed in C-9 as unchanged. |
| 14 | Accept | Flat response (C-5), the closed service stays editable (C-2), the ADR-0003 addendum shape follows PR #482: each is written into spec 072 in this PR. |
| 15 | Accept | All four tests added to the plan. |
