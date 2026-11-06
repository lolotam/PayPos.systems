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
