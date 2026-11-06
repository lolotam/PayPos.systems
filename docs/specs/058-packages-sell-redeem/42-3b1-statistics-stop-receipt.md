# 42-3b1 — authorized statistics diagnostic: evidence-collection stop

## Authority and execution boundary

The manager approved execution of [plan 304b8d04](42-3b1-next-diagnostic-plan.md):
private disposable databases only, A/B and B/A with baseline, parent-table ANALYZE in B
only, no optional arm, additional history, schema/index/constraint/RLS changes, migration,
production change, b2 or PR. Every 200-ms and data assertion remains unchanged.
The same instruction requires stopping on failed or ambiguous controls without open retries.

One execution was started. It stopped on missing valid load telemetry during the first A
arm. No B treatment, baseline control, second comparison block or instrumented RI capture
was reached. No further attempt was made. This is an incomplete/inconclusive diagnostic,
not a performance fix, a valid A/B comparison, an SA-10 pass or a rejection of H1/H2.

## Failure and available evidence

The owned lane was `pospay-test-sale-b1-6ac3ef10d0`, loopback port 55407.
The source fixture completed its common warmup and catalog/statistics snapshots. The
first untreated clone then entered the five-sale collection loop. Load collection failed
when its Docker streaming output was parsed at the end of the arm:

`SyntaxError: Unexpected token '\u001b', "\u001b[H{\"Block\"... is not valid JSON`

Docker emitted terminal-control sequences before JSON records despite redirected output.
The diagnostic parser assumed each nonempty line was directly parseable JSON. Therefore
the load guard could not be evaluated. Its exception occurred before the arm's checkpoint
and timing-assertion collection: there is no complete accepted arm result, no retained
five-sale timing array and no claim that five threshold assertions ran. The common warmup
is not an acceptance measurement. The failure is in diagnostic telemetry, not evidence
that the sale's permission, monetary or transaction behavior failed or passed SA-10.

The test exited 1 (one failed diagnostic test). The original normal SA-10 spec and product
code were not edited. No planner GUC or ANALYZE was added to a request. No index or
constraint was dropped, added or disabled. No representative-history data was added.

Artifacts, all under `F:/Dev/Temp/`:

- `pospay-42b1-stats-81716-receipt.json`: environment, settings, warmup, source statistics,
  catalog fingerprint, stop reason and database-cleanup checkpoint; arms array is empty.
- `pospay-42b1-stats-run.log`: test failure, exit and lane/Redis cleanup transcript.
- `pospay-42b1-stats-81716-experiment-source.ts`: exact temporary diagnostic source.
- `pospay-42b1-stats-run.mjs`: isolated-lane wrapper with generated temporary credentials.
  Credential values were not printed or retained in the source; no existing env was read.

## Cleanup and next step

The afterAll cleanup removed the owned arm database, restored the source's connection
setting, closed fixture resources and removed its source database. The receipt records
databaseCleanup=true. The wrapper removed its Redis and PostgreSQL containers/temporary
volume and restored original env files without reading them. Temporary diagnostic
source/config files were removed from the checkout after copying the source artifact.

The prerequisite for a new bounded run is an explicitly reviewed telemetry-capture repair:
handle Docker ANSI framing before JSON decoding, reject truncated records, persist raw
load samples and sale timing arrays before any parser can throw, and fail closed when
coverage is absent. Verify that parser independently on captured/synthetic formatting
without a database benchmark, then keep the same approved controls and block cap if a
new execution is authorized. This receipt does not authorize that execution or reset a
correction budget. No automatic retry, broader schema experiment or migration is proposed.
B1 remains unready; remaining acceptance tests, guards, Astra review and PR are incomplete.
