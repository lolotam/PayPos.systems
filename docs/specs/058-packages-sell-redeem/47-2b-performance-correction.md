# 47-2b — measured bulk-write correction

Date: 2026-11-06. The direct owner instruction is to finish the performance fix
and rerun the actual full limit, without reducing coverage, supported input,
atomicity, assertions or the 1,800,000-ms transaction ceiling. No new owner
decision is requested for this scoped correction. This document records diagnosis;
a completed full-bound result must be recorded separately before readiness.

## Evidence and rejected experiments

Per-component slot insertion issued 10,000 statements at the full limit. Bounded
typed JSONB insertion reduces this to 500 statements, each at most 7,300 records.
At 100 source rows, batching alone reduced insertion from 471,662.2978 ms to
428,611.5818 ms; it did not resolve the growth. See the baseline and batched
diagnostic receipts in this folder.

The initial complete-limit attempt timed out before COMMIT at 1,800,840 ms.
A later two-phase attempt was explicitly cancelled during diagnosis after
223.14 seconds overall; it is not a completed benchmark. Two-phase ordering alone
does not fix the planner problem. Neither DISCARD PLANS, force_custom_plan,
enable_seqscan=off nor enable_seqscan=off with jit=off produced an accepted fix.
The combined JIT/scan/cache experiment also failed to improve the full-size first
batch. None of these planner settings is in production code.

Actual EXPLAIN ANALYZE of the first 7,300-slot statement, after preparing all
500 parents and 10,000 components, measured:

| Variant | Statement ms | Company FK ms | Component FK ms | Slot guard ms |
| --- | ---: | ---: | ---: | ---: |
| Original indexes and guard | 24038.021 | 409.021 | 8853.807 | 14668.951 |
| Reordered service index only | 10069.200 | 208.487 | 230.513 | 9526.241 |
| Reordered index and grouped guard | 768.463 | 271.828 | 301.596 | 54.220 |

These are separate local runs, not a controlled CPU benchmark or a full-COMMIT
receipt. Each diagnostic deliberately rolled back after its first slot batch.
The input size before that statement was identical. No guard was disabled.

Nested auto_explain, enabled only on a disposable clone, showed an Index Scan
using package_components_service_fk_idx for the component FK. The plan estimated
one row but removed 9,500 rows by filter in a sampled lookup. This is a wrong
index choice on newly populated tables, not a demonstrated sequential-scan issue.
The old service index starts with company_id,business_id, so an ID lookup can
scan the activity's components. Reordering the service index to
company_id,service_id,business_id removes that misleading two-column prefix.
The actual component FK lookup then becomes inexpensive. The statement guard
also repeats equivalent parent/component checks thousands of times; grouping
the transition table removes those redundant probes without changing rejection.

Safe plan summaries and timings are retained under F:/Dev/Temp with prefixes
pospay-47-2b-nested-safe, pospay-47-2b-full-first-profile,
pospay-47-2b-reordered-first-profile and pospay-47-2b-both-first-profile.
Raw nested logs are local synthetic diagnostics and are not committed.

## Final write and schema design

The transaction claims parents in stable external_ref order with the existing
explicit conflict target, retaining only winners. It prepares all their components
before any slots, then writes bounded JSONB slot batches. It retains at most
500 prepared parents and 10,000 component definitions; no cross-parent slot array.
Amounts are moneyToString strings, IDs are injected UUIDv7, frozen allocation and
component order remain unchanged. Audit, outbox and final state remain in the same
transaction, including deferred conservation through COMMIT.

The replacement slot guard keeps the same name, signature, SECURITY INVOKER,
search_path, errors and permissions. Creation seals are checked for each distinct
tenant/business/parent key; initial states for each such key and state; ordinal
min/max for each tenant/business/parent/component key. Since ordinal is NOT NULL,
the range test is equivalent to rejecting any out-of-range ordinal. Missing and
invisible parent semantics retain NOT EXISTS. FK, RLS, uniqueness and deferred
conservation constraints remain enabled.

The reordered service index requires the same FK columns in corresponding order,
so the service FK is recreated NOT VALID and validated in a separate statement.
It relates exactly the same column pairs, with the same name and actions. Existing
rows satisfying the old FK satisfy the reordered FK; no data transformation is
needed. The new index is created CONCURRENTLY before dropping the old index
CONCURRENTLY. All concurrent statements precede the transactional suffix. Only
the branch's unmerged 0215/0216 artifacts are regenerated; 0214 is untouched.

Regression coverage includes transient failure after the first real slot batch,
deferred-COMMIT conservation refusal after audit/outbox have been attempted,
successful transient retry, and mixed slot batches checking low/high ordinals,
invalid initial states, component-specific bounds and every parent's creation seal.
