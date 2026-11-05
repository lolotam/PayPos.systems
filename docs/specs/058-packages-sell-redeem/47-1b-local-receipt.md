# 47-1b â€” local validation receipt

Implementation worktree: `F:/Dev/Worktrees/PosPay/feat-p1-058-47-1b-package-preview-worker`.
Initial base `88f822be`; manager granted migration **0212** and subsequently required
rebasing on `08931d26` (#870, one unrelated worker document test, no migration).
No real env, secret, staging, production or server access is part of this work.

## Scope

One worker use case, `ExecutePackagePreview`; real id-only outbox-to-BullMQ transport,
bounded object read and XLSX parsing outside transactions, tenant-scoped batched
services/refs/customers and guarded ready/failed persistence. Producer/polling routes
activate with this transport. No financial records, events or financial recovery.
Shared reader guards and pure package primitives are moved, with API compatibility
facades and preserved staff constants/errors/default sale behavior.

This PR takes #863 with a new migration; merged 0211 is unchanged. #864 stays open.
0212 replaces a trigger function only: no new CHECK, table scan or validation of
existing rows. New checks apply on pending-to-ready updates. Existing ready/failed
rows are not scanned/revalidated. Function permissions/search_path/identity persist.

## Tests observed

- Selected API/staff/shared-package-money regression tests: **145 passed across
  11 files**, including the unchanged full HTTP warm median assertion, **74.5563 ms**.
- Worker package parsing/validation pure tests: **18 passed**. Additional source-key/
  expiry/reference pure tests: **2 passed**.
- Worker preview integration plus public file reader: **12 passed across two files**,
  including the real 500-row/20-group/365-session workbook, privacy, duplicates/races,
  rollback, changed file, multi-error rows, unknown customer/service, ambiguity,
  duplicate refs, metadata negatives, RLS and indexed EXPLAIN.
- Shared technical reader: **4 passed**, preserving header/physical-row identities,
  formulas/rich text/error markers and the byte/row/column/sheet bounds.
- BullMQ transport after review fixes: **2 passed**. It verifies id-only queue data,
  three processing attempts and durable finalization after a DB outage and processor
  restart, with no further file processing. The paired preview integration rerun
  passed all **10** tests with the strengthened numeric row identity guard.
- Worker emitted-event spec: **12 passed** in the earlier combined reader/domain run;
  the fenced-producer exception is removed and support comes from the real module.
- Contracts/OpenAPI: **7 passed**; admin, POS and menu api:check passed.
- Typecheck **32 tasks**, lint/boundaries **33 tasks**, docs lint **0 errors / 29
  existing warnings**, module-map passed before the small review corrections. Final
  numbered-migration checks and any necessary correction-specific reruns follow.

Initial local failures were fixed without changing bounds or assertions: the shared
reader test incorrectly omitted header row 1 from sourceRows; one file-reader fixture
changed status without clearing its verified key; the new package initially needed
Node/type-extension build settings; refs use an explicit parameterized text array.
An over-broad temporary fixture text replacement was corrected before rerunning.
No final green result is claimed for a command that failed.

## Independent Astra review

Fresh read-only `gpt-6-astra` high reviewed tracked and new files against 88f822be.
It accepted the extraction design: unchanged ZIP/XML/sheet guards, staff bounds/error
mapping, pure zero-dependency financial primitives, stable PackageRuleError identity
and preserved default sale semantics. It found two P2 defects, both corrected:

1. Persisting failure could itself fail on the third attempt, leaving pending forever.
   Finalization now has a durable Redis progress marker and uses BullMQ's documented
   token-aware moveToDelayed/DelayedError pattern until the conditional DB update
   succeeds. Job data remains IDs only; a restart resumes finalization without parsing.
2. Text row ids such as "02" could evade distinct/disjoint partition checks. The
   trigger now requires JSON numeric bounded integers before any cast and compares
   numeric identities for distinctness and overlap. Regression negatives include
   text aliases, duplicate valid rows and valid/error overlap.

Primary transport reference: https://docs.bullmq.io/patterns/process-step-jobs .
The first reviewer did not run tests or review a final numbered migration/snapshot;
fresh final verification includes those after generation. The three guards apply
to the complete final scope; full API shards/full-suite gates remain CI-only.

## Final numbered-migration verification

Rebased onto `08931d2655b6613b35e38b8bb9a86bc5d4fa88a2`; main still has no migration
beyond 0211. Manager-granted `pnpm db:generate package-preview-ready-consistency
--custom` produced 0212 with unique journal idx 212 immediately after idx 211.
The generated snapshot's prevId equals 0211's id; deep structural comparison proves
its schema is unchanged (only id and prevId differ). Final SQL SHA256:
`A3C31E294B9A1F83B63F445EC62193A7FF0901CFB6D03787B6F7A170FCBDA679`.
There is no new CHECK or old-row validation; therefore no existing row can fail a
new CHECK during this migration. The manager was sent this impact and hash before
push, for DEP-1 backup and restore coordination. No real database was inspected.

Removed the draft SQL fallback from the worker fixture: it now fails explicitly
unless the real migration installed the result guard. The draft is no longer shipped.
Final private-cluster worker tests: **32 passed / 5 files**, including full-workload,
metadata/RLS/races and durable failure persistence. Worker known-event/file-reader
checks: **14 passed / 2 files**. API request/status/activation: **19 passed / 3 files**,
with unchanged warm acceptance assertion and final median **85.6219 ms**. Shared
technical reader: **4 passed**; admin/POS/menu generated client checks passed.

Final local gates passed: typecheck **32 tasks**, lint including boundaries **33
tasks**, docs lint **0 errors / 29 pre-existing warnings**, module-map and migration
journal/snapshot chain. Full suite and full API shards are CI-only.

`clean-code-guard`, `test-guard` and `docs-guard` completed against production, tests
and documentation. Real Postgres/Redis cover persistence and transport; fixtures
use synthetic identifiers/phones. Ports and pure domains follow project boundaries;
provider work remains outside transactions. Existing default money behavior is
covered by the selected API regression tests. Docs/spec/ADR/module-map/API schemas
match active routes and the real transport, not a dormant known-event registration.

Fresh independent `gpt-6-astra` high final re-check approved with **no confirmed
P0-P3 defects**. It verified both earlier P2 corrections, all retained 0211 guards,
multiple errors per row, function-only migration, unchanged snapshot schema, correct
prevId and unique idx 212. It reviewed files and tests read-only; it did not execute
tests or read any environment file.

Post-generation staff reader/import/RLS and default package-money regression rerun:
**113 passed / 7 files**, using the actual 0212 migration.

## External correction round 1 of 3 — prepared locally

Manager assigned Waleed_Bot threads r4486405004, r4486405021 and r4486405031.
No push is authorized until the remaining panel receipts complete on cb94b9de
and the manager explicitly releases the consolidated batch.

Payload validation now precedes the Redis catch. Invalid payloads/identities return
`{ delivered: false, error: 'PACKAGE_PREVIEW_EVENT_INVALID', retryInMs: null }`.
This is the existing dispatcher's terminal parked outcome (dispatcher.ts records
parked_at for a null retry delay), not an acknowledgement or transient Redis retry.
The transport validates companyId and aggregateId, takes previewId from aggregateId,
and rejects a different payload preview_id. UUID case differences are equivalent.
No preview rows are modified by the malformed-event path.

The workbook adapter rejects storage bytes above maxBytes with
IMPORT_FILE_SIZE_INVALID before invoking the shared XLSX parser. One added test
covers each finding: null payload, mismatched preview identity, and oversized
invalid XLSX bytes. The existing restart fixture now uses matching aggregate and
payload IDs, preserving its original durability assertions.

Private-cluster selected worker integration/transport/workbook tests: **15 passed
across 3 files**. Worker typecheck and lint/boundaries passed. An initial test-only
TypeScript assertion needed the same unknown bridge as the existing transport
fixtures; corrected before the successful checks. Migration 0212 and its SHA256
are unchanged. The three guards were applied to this correction diff.
### Consolidated round 1 additions and release

The manager confirmed all panel bots completed on cb94b9de and authorized the
single consolidated correction push. Duplicate findings are covered together:
file locking r4486469744/r4486474728/r4486507071; service indexing
r4486469752/r4486474718/r4486507079; negative price r4486469760.

Finalization now requests FOR SHARE on the scoped file-facts query in the same
withTenant transaction that locks the pending preview and writes ready. The initial
load remains unlocked. Files retention claims use FOR UPDATE SKIP LOCKED, which
conflicts with SHARE, and purge_started_at updates cannot pass the held file lock.
A deterministic real-Postgres test attempts a concurrent purge with a local 100ms
lock timeout after the final file check: it gets 55P03, ready commits, and the purge
then succeeds after lock release. Existing changed-file-before-check coverage remains.

Service matching now builds a normalized bilingual name Map once per sheet. Each
name retains distinct service IDs with the same last-matching-record precedence
as before. Rows/components use direct lookups. The matching regression covers
trim/case, Arabic, two labels for one identity, duplicate identity precedence,
missing names and ambiguity across distinct identities. Negative prices emit one
price_paid INVALID_PRICE; component validation uses a neutral price and remains
independent. The new exact-error regression prevents duplicated price errors.

The OTP startup Redis fake supports duplicate(); only package-preview BullMQ network
objects are isolated, while other real-constructor probes remain intact. The shared
readiness assertions retain database/dispatcher/redis and now explicitly include
package-previews. A new /ready 503 assertion proves preview failure remains blocking.
The entire otp-startup.spec.ts passed **10 tests** without weakened timeouts/assertions.

After the final price-helper extraction, selected worker integration, transport,
workbook, pure domain and file reader tests passed **40 tests / 7 files**, including
500 rows by 20 groups by 365 sessions and the new purge race regression. The earlier
lint max-function-lines failure was fixed by extracting price validation; no lines
were squashed and no lint rule or test expectation was weakened. Migration 0212 is
untouched; SHA256 remains
`a3c31e294b9a1f83b63f445ec62193a7ff0901cfb6d03787b6f7a170fcbda679`.
Round 1 final gates passed: typecheck 32 tasks; lint/boundaries 33 tasks; lint:docs
0 errors / 29 existing warnings; module-map and migration chain. Registry tests: 12
passed. Selected API request/status/activation: 19 passed, warm median 74.4901 ms.
Together with 40 scope and 10 startup tests, this round observed 81 passing tests.
The three guards passed the final correction diff. No review trigger or merge.
