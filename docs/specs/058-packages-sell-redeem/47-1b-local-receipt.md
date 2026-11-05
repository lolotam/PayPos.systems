# 47-1b — local validation receipt

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
