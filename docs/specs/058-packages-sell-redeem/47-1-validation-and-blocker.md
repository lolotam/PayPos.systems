# 47-1 validation and performance blocker — 2026-11-05

Historical validation checkpoint, 15:38 Kuwait. The manager subsequently approved
asynchronous preview in the decision supplied as 16:03 Kuwait. The measurement below
remains evidence; the execution-model permission question is answered. The subsequent
size assessment and proposed split are in `47-1-async-split-plan.md`.

Status: implementation present, **not ready for the migration lane**. The full-width
preview exceeds the existing 200 ms synchronous-work rule. The failing assertion is
retained; no bound, security guard or workload limit was relaxed.

## Implemented scope

- One preview use case, template and preview HTTP routes under
  `/v1/businesses/{businessId}/packages/import/`, Zod contracts, OpenAPI and both
  generated frontend schema files.
- `import:packages:business`, owner/GM/BM defaults, device denial, Arabic/English
  permission names and an unnumbered seed SQL draft matching migration 0201's shape.
  The draft was applied twice on the private database to prove idempotence.
- `@Require` plus `@RequiresFeature('orders')`, enforced route-coverage entries,
  module/provider wiring and injected object storage at the application root.
- `orders -> files` and the three package-preview public readers declared in the
  module map, with ADR-0010/ADR-0034 addenda. The manager's binding 47-1 design is
  copied as `47-1-manager-design.md`.
- Shared bounded workbook reader and moved reader tests; staff keeps its original
  limits and error type. Package limits are 2 MiB, 500 data rows, 68 columns, 4 sheets.
- Pure row validation, duplicate references, early skipping of existing references,
  batched customer lookup under the caller's tenant transaction and privacy-safe
  persisted rows. Components store compact base/final unit values, preserving every
  fils and the last slot's remainder without materializing session objects.

No financial commit, worker, event or recovery sweep was added. The protected sale,
record/append and redemption-cancellation use cases were not edited. No final
migration numbering, `db:generate`, push, PR, merge or deployment occurred.

## Independent review and guards

Two fresh-context, read-only reviews used `gpt-6-astra`, medium. The first found two
P2 defects: unheaded populated margin columns were discarded, and existing refs
were resolved after row validation. Both were corrected with regression tests.
The recheck verified both fixes and reported no remaining confirmed P0–P3 defect
in static review. The reviewer did not run tests; this does not waive the measured
performance failure.

The clean-code-guard, test-guard and docs-guard passes were performed. Corrections
included compact allocation, a sanitized database-boundary error that cannot log
phone query parameters, independent test fixtures without prohibited cross-module
imports, restoring mutated permissions/features between tests, and accurate source
and migration-lane documentation.

## Executed validation

- Workspace `pnpm typecheck`: passed before the final small name/comment changes;
  it is not an exact-final-head CI receipt.
- `pnpm lint:docs`: passed with 29 existing warnings. `pnpm module-map:check` and
  `git diff --check`: passed before this documentation addition.
- Both generated-client `api:check` commands passed.
- Domain allocation/slots/import row/import validation specs: latest run 68 passed.
- Package preview plus package workbook bounds: 21 passed before introducing the
  strict performance assertion. Earlier shared reader/staff structure/template
  roundtrip run: 4 files, 38 passed.
- Package-import contract and OpenAPI specs: 7 passed. Role-default policy spec:
  1024 passed. Permission-label spec: 4 passed.
- Full lint attempts exposed test-boundary imports, function size/JSDoc, a non-null
  assertion and a control-regex rule. These were fixed; targeted API lint passed.
  Final full-lint status is recorded separately below when the command completes.

The first API attempt failed because workspace packages were not built; prerequisite
builds resolved it. A later benchmark had a local Redis `WRONGPASS` failure. Its
2214.78 ms measurement was discarded as the decision evidence. The decisive run
used a separate loopback-only `redis:7-alpine` container and explicit local
`REDIS_URL`; it had no Redis authentication errors. No other worktree's env was read.

## Decisive full-preview measurement

Command: `pnpm --filter @pospay/api exec vitest run
src/modules/orders/__tests__/package-import-preview.spec.ts -t '500 full-width'
--reporter=verbose`, with private local Redis and the `packages-47-1` Postgres lane.

One warm-up, then five full calls, including file facts/authorization, storage read,
ZIP/XML validation, ExcelJS parsing, row/customer/ref validation, JSON storage and
transaction completion. Workload: 500 rows, all 20 service groups populated, 365
original/remaining sessions per component.

- Warm calls in milliseconds: 1057.0824, 750.7027, 663.3985, 719.6987, 688.3852.
- Median: **719.6987 ms**, required **less than 200 ms**.
- Stored rows JSON text: **2,184,784 bytes**; allocation was already compact.
- Result: one performance test failed; the other 16 tests were excluded by the
  explicit test-name filter, not silently skipped as a gate waiver.

This is a local measurement, not a production latency claim. The second run
isolated Redis and reproduced the over-budget behavior without its auth failure.
The current brief reserves worker/events for 47-2, so changing the preview execution
model requires a manager design/scope decision. Question `47-1-PERF-1` is PENDING in
`owner-questions.ar.md`. No migration-lane readiness is claimed.

## Final local checkpoint — 15:38 Kuwait

- Final `pnpm lint`: exit 0, 30 successful tasks (29 cached), 56.462 seconds;
  boundary checks are included. Existing warnings were retained.
- Final `pnpm lint:docs`: 0 errors, 29 warnings; final `pnpm module-map:check`
  and `git diff --check` passed.
- The private Postgres lane and its volume were removed with `lane.mjs down`.
  The temporary Redis container was removed after checking its task ownership label.
- `.env` remains ignored; no env was staged. Changes remain uncommitted and
  unpublished while the execution-model question is pending.

Recommended next step: resolve `47-1-PERF-1` before granting the migration lane.
