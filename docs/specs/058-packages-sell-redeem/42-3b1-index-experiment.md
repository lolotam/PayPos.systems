# 42-3b1 — manager-authorized disposable-clone index experiment

## Authorization and controls

PP-112 manager authorization, 2026-11-06: experiment only on an owned disposable clone;
no staging/shared database, repository schema/migration change, production planner GUC,
constraint removal, threshold change, b2 or PR publication. Migration ownership remains
unassigned until evidence supports a concrete dependency proposal.

The real catalog confirmed `package_components_entitlement_fk_idx` is not constraint-backed.
Its columns are `(company_id,business_id,entitlement_id)`. The existing unique index
`package_components_entitlement_id_key` starts with exactly that prefix and adds `id`.
These checks are executable assertions before DROP INDEX, not assumptions from SQL text.

A seeded source database was disconnected and frozen against new connections. Three
databases were copied from that same snapshot: baseline, removed-index, baseline control.
Each began with identical schema and synthetic data. Each ran one warmup and five complete
SellPackageUseCase transactions, through restricted pospay_app connections, through COMMIT.
Only the middle clone dropped the named non-constraint index. No ANALYZE, planner GUC,
FK/RLS/seal/trigger change or capacity change was applied. Trials ran serially on one lane.

The original benchmark's financial INSERT-count, 7,300 rows, 30.000 conservation, 20
components, event-contract and persisted idempotency-response assertions were retained.
Every timing assertion still requires less than 200 ms; soft collection in this separate
diagnostic records all failures instead of ending the comparison at its first timing failure.
The normal SA-10 spec was untouched. A catalog fingerprint compared all public constraints,
triggers and table RLS flags before and after each arm. The dropped index was recreated
in finally before that clone was removed. The source connection restriction was restored.

## Controlled full-transaction results

All values are milliseconds, including COMMIT. All fifteen timing checks failed;
all data and catalog-integrity checks passed. No passing gate is claimed.

| Arm | Five warm complete transactions |
| --- | --- |
| Baseline | 881.8973, 875.8434, 966.2274, 1208.2021, 1544.0296 |
| Index removed | 891.6729, 853.8477, 855.3549, 951.1228, 917.2511 |
| Baseline control | 977.2058, 974.4386, 1085.4072, 1001.5051, 1039.1320 |

The removed arm overlaps the baseline range. Ordered runs and host variation prevent a
strong causal latency claim from this small sample. Removing this index alone did not
satisfy the unchanged gate. Separate EXPLAIN/nested-log sales happened after each arm's
normal timing trials, so their logging overhead is excluded from those fifteen timings.

## Audit and artifact trail

An initial diagnostic audit mistakenly included index relations among RLS table entries;
it therefore rejected the middle arm before measuring it. That attempt is invalid for
comparison. The audit was corrected to table/partition relations, without weakening any
benchmark assertion. Its logs remain preserved. A subsequent complete comparison produced
the results above. PostgreSQL log rotation lost some earlier nested plans; the removed arm
was repeated alone to preserve its plans, separately from the controlled comparison.

Artifacts under `F:/Dev/Temp/`:

- `pospay-42b1-index-experiment-source.ts`: exact isolated diagnostic source.
- `pospay-42b1-index-final-run.log`: complete controlled comparison and failures.
- `pospay-42b1-index-{baseline,removed,restored}-metadata.json`: catalog checks.
- `pospay-42b1-index-{baseline,removed,restored}-phases-*.json`: complete statement phases.
- `pospay-42b1-index-{baseline,removed,restored}-explain.json`: instrumented slot statements.
- `pospay-42b1-index-removed-trace-run.log`: separate removed-arm plan capture.

Temporary diagnostic source/config files are not product changes and are removed from the
checkout after execution. Only this evidence record is retained in the repository.

## Nested-plan result and disposition

The baseline control uses `package_components_entitlement_fk_idx`: 7,300 lookups,
69,350 rows rejected by the id filter, at most 19 per lookup, one loop each.
The isolated removed-arm capture instead uses
`package_components_entitlement_position_key`: the same 7,300 lookups, 69,350 rejected
rows, maximum 19, one loop. Removing the candidate index does not make PostgreSQL choose
the four-column identity index. Company RI still uses companies_pkey with no rejected rows.
The complete removed-arm summary is `F:/Dev/Temp/pospay-42b1-index-nested-summary.json`;
its raw log is `pospay-42b1-nested-bc81c28080.log`. The earlier baseline-control plans
remain in `pospay-42b1-nested-59d1b86e4e.log`.

The isolated repetition's five full transactions were
895.1265, 903.1492, 961.8570, 948.2894, 915.6610 ms; all failed. Its catalog and data
assertions passed. All owned test databases, PostgreSQL/Redis containers and temporary
volumes were removed; original env files were restored without reading their contents.

**Disposition:** do not propose a production dependency that merely drops this index.
This experiment did not establish a useful plan correction or satisfy SA-10. A broader
index/constraint-layout correction would need a separately defined experiment and approval;
no such DDL, migration number, production planner setting, threshold waiver or asynchronous
sale change is authorized or implemented here. b1 remains unready, and b2/PR stay closed.
