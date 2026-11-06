# 42-3b1 — transaction internals (manager-approved split)

## Binding decision, 2026-11-06

Source: the manager's direct message in the existing 42-3b task conversation.
No new owner question or business rule was introduced. The message is preserved verbatim:

> PP-112: قرأت تقريرك الأخير؛ اعتماد مدير لتقسيم42-3b إلى b1 transaction internals ثم b2 HTTP كما عرضت، كل PR تحت2800 بلا حذف tests ولا route فيb1 ولا migration. استأنف الجلسة الحالية بـb1 فقط بعد تحديثmain وقياس الحجم/الملكية لتجنب التعارض. أبقِ b2 بعد دمجb1، لا جلسة جديدة ولا تفعيلHTTP مبكر. أرسل الحالة والخطوة التالية وأي تعارض ملفات، واحفظ القرار والتقديرات والسجل القديم. هذا تقسيم تنفيذ داخل النطاق الحالي وليس إعفاء جودة أو رفع سقف.

The original [plan](plan-42-3.md), [manager review](42-3-manager-plan-review.md) and
[dependency/size record](42-3b-dependency-refresh.md) remain historical evidence.
This decision supersedes their unsplit 42-3b delivery assignment, not the sale requirements.

## Refresh and ownership

- Main checked at `dd7c42baaa04b5cb0df5fde03cb739ffde7e9e78`; no sale use case,
  transaction writer or sale HTTP endpoint exists there. No duplicate implementation is needed.
- Merge `60332778` incorporated this main without rebase or force push.
  Its sole conflict was `orders.module.ts`'s controller list. Main's list was retained,
  preserving package import preview and omitting the sale controller/provider.
- Open PRs checked after the merge: #882 (POS leave), #888 (worker rating Lua), and
  #889 (worker package import commit). None owns the API sale/identity/tenancy source files.
  #889 shares append-only module-map declarations and spec 058's execution table; preserve
  both sets of lines and refresh again before pushing. Its worker storage/migration work
  is outside b1; b1 adds no migration and needs no migration lane.
- Reuse main's existing `packageSalePlace` reader/export and its shape/isolation/EXPLAIN
  coverage. Reuse the package calculation exports now delegated to `@pospay/domain`;
  do not copy or restore their former implementation.

## Delivery boundaries and estimates

All sizes count additions plus deletions against the PR base, including tests and docs.
Estimates remain provisional until complete diffs are measured; the hard cap is 2,800 per PR.

| Delivery | Scope | Inclusive estimate |
| --- | --- | ---: |
| b1, this session | Sale permission read/export, transaction port and adapters, use case, inserts, audit/event/response mapping; pure and real-DB acceptance coverage | 2,100–2,500 |
| b2, only after b1 merges | Controller/filter and registration, public error/i18n changes as needed, OpenAPI/clients and complete real HTTP acceptance coverage | 900–1,200 |

b1 does not register a sale route or provider, publish a sale OpenAPI path, change payment
capture, add a migration or deploy. Composition binding for directly exercising the transaction
internals may live in `orders.module.ts`; it does not activate HTTP. The transaction stays
one `withTenant`, with bigint money, injected time/IDs and audit/outbox/idempotent response
committed together. Unknown failures are not successful sales.

## Acceptance ownership

- b1: SA-01…SA-05 and SA-07…SA-09 persisted outcomes; SA-05b/08b/08c both-order
  seller/type/service races with real connections and explicit barriers; same-key commit/replay
  and rollback/retry; authority expiry/revocation/DENY/feature checks after waits and replay;
  audit/outbox/COMMIT failure rollback; isolation; mapper and record-reader regression tests.
- b1 SA-10: maximum 20 × 365 slots, exactly one insert per financial table, one warmup,
  five complete measured transactions including COMMIT, each below 200 ms. A failure stops
  the sale delivery for a spec decision, without weakening the gate or storage seals.
- b2: SA-06 contract-to-HTTP refusal; SA-11 real route/guard/device/feature behavior;
  transport error details, actor-bound fingerprints and replay; timezone/snapshot/refusal
  coverage through real HTTP persistence. Every SA-01…SA-11 requirement must be satisfied
  before the route is activated; b1 coverage is reused, not discarded.
- Both: applicable PP-113 local gates, clean-code-guard, test-guard, docs-guard, independent
  Astra high review and current exact-head CI/review gates. No merge is authorized here.

## Preservation of pending b2 work

WIP `e7e95913` and pre-split head `c369e00a7` preserve every delivered file, including
`package-sale-http.spec.ts`, both HTTP source files, `package-sale-openapi.ts`, registry,
generated clients and the original wiring/error/i18n changes. They are excluded from b1's
active tree to enforce this approved boundary, not abandoned to fit the cap. Restore and
adapt that work from these commits after b1 merges; never overwrite newer main artifacts.
No test is waived, skipped to pass or removed from the acceptance matrix.

## Current validation state

The manager has since authorized [performance diagnosis and bounded correction](42-3b1-performance-diagnosis.md)
without changing the 200-ms gate. The paragraph below preserves the earlier stop checkpoint;
no new owner decision is required merely for a failed timing measurement.

SA-10 was executed first and failed all five complete-transaction timings; delivery is
stopped for spec review. See the [measured stop receipt](42-3b1-sa10-receipt.md).
Earlier api:check results describe the pre-split head only. Remaining acceptance coverage,
typecheck, lint, guards and independent Astra review are not complete. The binding factory
uses the existing `bindLineEditReaders` precedent in persistence; it does not register a
sale provider or controller in `orders.module.ts`.
