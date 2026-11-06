# 42-3b1 — load capture repair, DB rerun pending manager review

## Scope and proof

The manager authorized reversible load-capture/sample-persistence repair only after
[b72ffd24's stop](42-3b1-statistics-stop-receipt.md). No DB comparison was rerun.
The original failed run did not retain its full Docker stream; that loss is not concealed.
A new raw stream was captured from an owned, network-disabled, 32-MiB idle shell container
using the already available postgres:16-alpine image with its entrypoint overridden.
No PostgreSQL server, database, network port or env file was used. The container was removed.
Fixture: `scripts/test-db/fixtures/42-3b1-docker-stats.raw`; metadata/raw originals remain
under `F:/Dev/Temp/pospay-42b1-docker-stats.raw` and `.metadata.json`.

The raw bytes reproduce the old JSON.parse failure. They contain cursor-home/erase ANSI
before JSON, erase-to-end after JSON, and control-only lines/tail. The fix removes only
recognized framing at line boundaries; it does not strip arbitrary content inside JSON,
filter high load, coerce malformed percentages or skip corrupt records. A complete JSON
record still needs its newline; a final complete control-only tail is permitted.

## Reviewable diff

- `scripts/test-db/load-parser.mjs`: strict UTF-8/framing/JSON/container/load-field validation;
  rejects malformed, truncated, missing-field, wrong-container and insufficient evidence.
- `scripts/test-db/load-journal.mjs`: writes raw stdout/stderr, host samples and each completed
  sale to exclusive attempt files, flushing every append before parsing/aggregate generation.
  Status starts unaccepted; malformed evidence, missing samples or unclean stream leaves it
  failed. Once finished/failed the journal cannot be reused. Evidence completeness does not
  mean performance acceptance: an elapsed value of 999 ms remains 999 in the passing test.
- `scripts/test-db/load-capture.test.mjs`: replay of actual saved raw, plain JSON equivalence,
  split chunks, malformed/truncated data, sample loss, unexpected stream termination and
  preservation of raw bytes/timings on failure. No database setup is involved.

The temporary experiment integration is separately reviewable at
`F:/Dev/Temp/pospay-42b1-load-tool.patch`, against the exact failed-run source. Its repaired
source is `F:/Dev/Temp/pospay-42b1-stats-repaired-review.ts`. It journals chunks/host samples
as received, saves execute-through-COMMIT elapsed/phases before data assertions, waits for
the owned Docker stream to close with a bounded deadline, and refuses incomplete output.
The source was syntax-checked by TypeScript transpilation and compilation of the emitted
JavaScript without executing the module. Direct node --check could not parse its mixed
TypeScript imports; it is not reported as a passing typecheck. DB integration remains unrun.

## Limited execution proposal — no current DB authorization

1. Manager reviews this diff and temporary integration patch. Keep the original raw fixture,
   failed receipt and all rejected attempts; no correction-budget reset is inferred.
2. On approval only, apply the reviewed temporary integration to the narrow diagnostic
   harness. Create a new exclusive artifact directory for each arm. Persist raw stdout/
   stderr and per-sale/host records before any parser or final receipt can throw. Preserve
   collection errors and any earlier data failure; never convert them into accepted load.
3. Run the already bounded plan once: A/B then B/A with baseline, at most two blocks,
   common warmup/snapshot and B-only parent ANALYZE. No optional history, schema/index/FK/
   RLS changes, production planner setting, production change, b2 or PR.
4. Keep every original assertion and each full-transaction <200-ms check. Apply unchanged
   CPU/load/memory and baseline-drift guards. At least two valid host/Docker records and
   exactly five persisted sales are completeness minima, not proof of equal environment;
   inspect before/during/after coverage and retain load/I/O values for the actual guards.
5. Any malformed, lost, truncated or insufficient telemetry, unknown stream close, load
   ambiguity, data failure or incomplete 7,300+7,300 nested RI coverage stops the run.
   No automatic retry. Capture each arm's logs before rotation and preserve normal timings
   independently from instrumented sales. Clean up only owned resources and restore env
   files without reading them, as before. Report incomplete evidence as inconclusive.

No shared orders.module.ts, OpenAPI or query ownership files changed. Coordination with
57-2 is required before a future push touching shared additions; other merge ordering does
not block this tooling work. B1 performance and all remaining delivery gates remain open.

Validation: the five focused Node tests passed, targeted ESLint passed, and lint:docs passed
with 0 errors/29 existing warnings. git diff --check passed. The committed raw fixture was
byte-compared with its staged blob; SHA256 is
`63dfe6eeaed65cd01c7040470c0b2e205827f635556f959f524ef7a8cb7277aa`.
No full suite, DB benchmark or production gate was run for this tooling repair.
