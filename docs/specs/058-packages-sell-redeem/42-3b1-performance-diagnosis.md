# 42-3b1 — performance diagnosis in progress, 2026-11-06

## Resume authorization

The earlier [SA-10 failure](42-3b1-sa10-receipt.md) remains valid historical evidence.
The manager subsequently authorized diagnosis and bounded correction rather than waiting
for an owner decision merely because performance failed. The direct message is preserved:

> PP-112: آخر تقرير منذ أكثر من30 دقيقة يطلب مسار الاستئناف. استأنف تشخيص الأداء ثم إصلاحه ضمن b1 والمواصفة المعتمدة: حد كل معاملة كاملة حتى COMMIT أقل من200ms ثابت، ولا تغيير الذرية أو حدود البيانات أو assertions. ابدأ بقياس تفصيلي يحدد عنق الزجاجة، ثم التحسين المحدود والتحقق بنفس benchmark والاختبارات المتبقية. لا حاجة لقرار وليد لمجرد فشل الأداء؛ إذا احتجت تغيير عقد/سقف أو تجاوز رصيد تصحيح، ارفع خطة محددة قبل ذلك. main الحالي da775eb5، احفظ العمل وراجع التداخل قبل تحديثه. أرسل الحالة والخطوة التالية، ولا تفتح b2 أو PR غير جاهز.

The working tree was clean at `f09874f58`. Merge `dd39bef42` incorporated main
`da775eb5e5b62adcb48b26d1e55fdba1a2ce671f` without conflicts. Open PR #882 changes
POS leave only. API sale files have no active ownership overlap; module-map additions
were preserved. Migrations 0215/0216 and their slot-guard/index optimizations are inherited
from main, not authored by b1. No migration, HTTP activation or PR publication is added.

## Complete-transaction baseline on updated main

The same 7,300-slot benchmark retains one warmup, five measurements and every original
assertion. A test-only transaction proxy records execute-await intervals and the interval
from callback completion to wrapper return (COMMIT/deferred checks/driver/scheduling).
Concurrent reader calls can overlap; their durations must not be summed as server CPU.
Statement labels contain SQL placeholders only; no parameters are recorded.

Warm complete transactions with the existing UNNEST writer:
`1200.7984, 1145.1851, 1052.0018, 1150.0753, 1019.9035 ms`. All fail the unchanged
200-ms ceiling. For measured sale 1, slot insertion took 910.5015 ms and commit/return
64.8900 ms; for measured sale 5 they took 724.4641 and 60.6317 ms. Slot insertion is
the dominant observed client interval; there is no assumption that transport alone causes it.

## PostgreSQL statement breakdown

A separate diagnostic executes the actual slot INSERT under
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on the same full-use-case path, then asserts
that 7,300 rows committed. It does not replace the normal SA-10 benchmark. The safe JSON
artifact is `F:/Dev/Temp/pospay-42b1-slot-profile-32620.json`.

| PostgreSQL measurement | ms | calls |
| --- | ---: | ---: |
| Planning | 0.378 | 1 |
| Full slot statement execution, including immediate triggers | 605.339 | 1 |
| Company FK | 219.373 | 7,300 |
| Component FK | 245.457 | 7,300 |
| Slot insertion guard | 40.261 | 1 |

FK checks dominate this server-side sample. This is a local measurement, not a universal
lower bound or proof that every SQL-only correction is exhausted. Constraints stayed enabled.
An initial diagnostic config incorrectly concatenated include patterns with mergeConfig;
that run was cancelled, not counted. Replacing test.include explicitly limited the next
run to the one diagnostic file; one diagnostic test passed and its JSON was saved.

## Bounded candidate and current outcome

The candidate slot statement passes one bounded JSONB recordset with slot ID, component ID,
ordinal and money text. Company/business/entitlement are transaction-plan constants rather
than repeated per-slot arrays. This follows the existing worker bulk-write encoding while
keeping bigint-to-text money conversion, all 7,300 rows, one financial INSERT per table,
the same transaction, constraints, audit/outbox and idempotency result. No SQL constraint
or timing assertion is disabled or relaxed.

Warm complete transactions with this candidate:
`819.9201, 842.3279, 874.7067, 899.4680, 911.5412 ms`. This separate run is lower than
the observed baseline, but is not a controlled causal CPU comparison or an accepted fix:
**all five still fail 200 ms**. The three existing real-DB persistence tests passed,
including conservation failure rollback and cross-company read isolation.

Further diagnosis/correction remains authorized within b1. Consult the required advisor
on safe next investigation before any broader storage/contract proposal. Remaining races,
permission regression, rollback/replay coverage, local gates and independent Astra review
are not complete. No readiness, waiver or correction-budget reset is claimed.

## Follow-up evidence after the advisor consultation

The PP-136 advisor suggested checking complete phases, current-writer instrumentation and
nested FK plans before any storage proposal. It disclosed incomplete governing-document
reads; this advice is not the independent Astra review. Its expectation that the component
FK already used a single-key lookup was contradicted by the subsequent actual nested plans.

The unchanged full benchmark was repeated with JSONB: `926.6503, 1889.5157, 2479.8693,
2818.0740, 2656.7041 ms`; all five failed. The three persistence tests passed again.
Large variation means separate-run differences do not establish a causal speedup.
The complete first measured transaction is saved, with placeholder-only statement labels,
at `F:/Dev/Temp/pospay-42b1-phases-93448-1.json`. Its total was 926.6503 ms:

| Phase | ms |
| --- | ---: |
| Transaction entry | 3.7795 |
| Initial place read | 2.5616 |
| Initial membership / permissions / feature awaits (overlap) | 5.7505 / 10.0925 / 13.1346 |
| Idempotency lock-timeout read / claim / restore | 2.6597 / 3.2532 / 2.3733 |
| Company / membership locks | 2.4621 / 2.4841 |
| Package type / components reads | 2.6825 / 2.1875 |
| Service locks / snapshots | 2.4092 / 2.4208 |
| Seller lock | 2.3196 |
| Fresh membership / permissions / feature awaits (overlap) | 5.1035 / 9.4280 / 11.4240 |
| Fresh place / customer | 2.3179 / 2.1852 |
| Performer company / scope / employee reads | 1.1390 / 4.3770 / 3.8145 |
| Discount company / membership / business-setting locks | 2.2922 / 2.1277 / 2.3632 |
| Discount business scopes / database clock / effective limit | 2.6129 / 1.1658 / 3.0163 |
| Entitlement / component / slot INSERTs | 3.9160 / 36.4853 / 683.1392 |
| Audit / outbox lock / outbox INSERT / saved response | 4.1470 / 1.9115 / 2.0434 / 2.9554 |
| COMMIT and return | 47.6653 |

Await intervals are not additive CPU time. Unaccounted total time also contains application
work, driver work and scheduling; it is not attributed to a particular function without measurement.

Current-writer EXPLAIN was repeated with every constraint enabled. In the later run,
TIMING ON reported 1069.745 ms server execution, 1130.5906 ms client await; TIMING OFF
reported 923.690 ms and 966.3641 ms. Earlier values were 1916.027 / 2033.4551 ms ON and
1575.009 / 1683.6688 ms OFF. These ordered samples establish that removing per-node timing
alone does not make this statement pass; they do not isolate instrumentation cost precisely.
Safe artifacts: `F:/Dev/Temp/pospay-42b1-slot-profile-54964-true.json` and `-false.json`.

Nested auto_explain ran on a new **pospay_app** connection in the disposable test clone.
Only the owner setup connection set database-local preload/logging defaults; they were reset
in finally, the restricted connection passed ping(), and the clone/cluster were removed.
No FK, RLS, trigger or constraint was disabled. The diagnostic committed 7,300 rows.
The three diagnostic cases passed. These instrumented timings are not accepted SA-10 results.

The safe extracted summary `F:/Dev/Temp/pospay-42b1-nested-summary.json` shows:

- Company RI uses `companies_pkey`, one returned row and one loop (7,325 checks across
  all sale tables, including the 7,300 slot checks).
- All 7,300 component RI checks use `package_components_entitlement_fk_idx`, not the
  existing unique component identity index. The index condition fixes company/business/
  entitlement; `id` is a filter. Rows removed are 0 through 19, each repeated 365 times:
  69,350 rejected rows in total. Every lookup returns one row in one loop.
- Thus a real alternative plan remains to investigate. The next bounded diagnostic compares
  transaction-local generic/custom plan modes with constraints intact, before proposing any
  schema change. No production planner setting has been changed or accepted as a fix.

## Bounded plan-cache experiment and proposed dependency

The next diagnostic compared transaction-local plan-cache modes on the actual JSONB slot
INSERT, with TIMING OFF, all constraints enabled, and the same 7,300 committed rows.
`force_generic_plan` reported 1850.616 ms server execution / 2015.9435 ms client await;
`force_custom_plan` reported 4787.484 / 4903.7232 ms. All three diagnostic cases passed
their data checks. These are separate diagnostic sales, not passing performance tests.
The default nested-plan case was also repeated; no planner GUC is proposed for production.
Artifacts: `F:/Dev/Temp/pospay-42b1-slot-profile-85856-force_generic_plan.json` and
`-force_custom_plan.json`. Host/run variation precludes ranking these against other runs.

There is now a concrete storage dependency candidate, not a request to waive 200 ms:

1. Investigate the redundant parent index `package_components_entitlement_fk_idx`
   `(company_id,business_id,entitlement_id)`. The existing unique index backing
   `package_components_entitlement_id_key` begins with those same three columns and adds
   `id`; it can support the reverse entitlement lookup while testing all four RI predicates.
2. In an explicitly authorized disposable-clone experiment, measure removing only that
   redundant non-constraint index. Capture actual nested RI plans, including filters and
   rows visited. If the planner chooses another partial-predicate index, investigate its
   cost before choosing a storage correction. Never remove or weaken any FK/RLS/seal.
3. Only if that experiment is useful, let the manager assign a storage-owner migration
   dependency: index correction, schema/snapshot alignment where applicable, reverse-FK
   EXPLAIN coverage, and company/business/entitlement negative-FK tests. Preliminary size
   allowance: 80–140 handwritten lines plus generated artifacts, to be measured before
   approval; no migration number or migration file has been allocated here.
4. After the dependency lands, merge main normally and run the unchanged complete SA-10
   benchmark. Only then resume the remaining b1 race/replay/rollback/access tests and gates.

This is a targeted plan issue, not proof that fixing it alone can meet 200 ms. Company RI,
application work and commit work remain measured costs. No hardware-independent lower bound,
impossibility claim, contract change, data reduction, asynchronous sale or relaxed assertion
is proposed. Any further storage/contract proposal needs its own evidence and decision.

The manager's no-migration boundary means this storage experiment/correction is handed back
before implementation. b1 remains unready; no PR, b2 route, storage DDL or migration was added
to the product. Disposable-clone logging settings were reset and owned temporary clusters
were removed; original env files were restored without reading their contents.

## Local validation checkpoint

- The nine existing isolated sell-package use-case tests passed using an explicit narrow
  unit config without database setup. The three existing persistence tests passed in the
  latest normal benchmark run; SA-10 itself remains failed, with no assertion changed.
- Targeted lint passed for the diagnostic helpers/config and the sale place adapter/port.
  An initial max-lines-per-function finding in the diagnostic was fixed by extracting its
  EXPLAIN/artifact responsibility into a named helper, without line compression.
- API typecheck initially found that main expanded SessionPlacePort with branchTimezone.
  The sale adapter and transaction now use a documented Pick of read, the sole capability
  sale consumes; no new read or runtime behavior was introduced. Other initial errors
  referenced stale contracts/i18n build outputs after merging main; both packages were rebuilt.
  The repeated `pnpm --filter @pospay/api typecheck` then passed.
- `pnpm lint:docs` passed with 0 errors and 29 existing TODO warnings.
- `pnpm module-map:check` passed. `git diff --check` passed.
- Full slice lint, remaining real-DB acceptance tests, guard passes and independent Astra
  review remain incomplete. These checkpoint checks are not a readiness declaration.
