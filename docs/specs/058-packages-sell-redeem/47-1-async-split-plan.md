# 47-1 asynchronous preview — scope assessment and split proposal

Status: **split approved** by the manager in the decision supplied as 15:57 Kuwait.
Execute 47-1a in the same session, then start 47-1b only after 47-1a merges. One PR
at a time; no merge by the implementation session and no generation/numbering/push
before lane granted. The sizing section below records the earlier assessment.

## Recorded decision and unchanged limits

Manager decision supplied as **16:03 Kuwait, 2026-11-05**, recorded verbatim in
`owner-questions.ar.md`: the API accepts a preview request with file facts only,
creates a pending package preview and id-only outbox event atomically, responds 202,
and proves warm acceptance below 200 ms. The worker reads storage outside any tenant
transaction, then validates and saves ready/failed state under `withTenant`.
Polling reads go through `queries/`. The existing 719.6987 ms synchronous measurement
is retained as the reason for the change.

Keep **2 MiB / 500 data rows / 68 columns / 4 sheets**. Keep the performance assertion:
the bounded operation becomes full API acceptance, including authorization and COMMIT,
with one warm-up and five measured calls. Keep a separate full-workload worker test;
do not delete or reduce the workload to obtain a green result. Financial package
commit, redemption, sale, cancellation and their recovery remain outside this change.

## What the repository actually supports

- `packages/db/schema/staff-import.ts` already has `status`, `requested_at`, result
  rows/errors/counts and `error_code`. Its status CHECK accepts only `ready`,
  `commit_requested`, `committed`, `failed`; there is no pending-preview state.
  Staff starts at `ready`. Do not reuse `commit_requested` for parsing: existing staff
  commit/recovery paths give it a different meaning.
- Existing UPDATE grants and guards must be checked before granting updates to
  result rows/counts/errors. The new write path must be restricted to package previews
  leaving `pending`, preserving staff's behavior and financial commit semantics.
- Staff provides the durable transport precedent: `employee-import.processor.ts`
  publishes to BullMQ outside the outbox claim transaction and uses terminal database
  state for idempotence. It does not provide an asynchronous parser or pending-preview
  schema that can simply be wired into orders.
- The hardened reader and ZIP/XML guards live under `apps/api/src/shared/import/`.
  Worker `rootDir` is its own `src`; importing API files from worker is not an allowed
  sharing mechanism. The package validator also depends on API-local pure allocation,
  definition, slots and error types. Copying those rules would create two money/security
  implementations.
- Worker orders currently has database-event consumers, but no package-preview BullMQ
  processor or lifecycle/startup binding. Worker catalog/files/customer public read
  adapters for this path also have to be provided on the worker side.

## Size assessment

Measured before changing runtime code for the asynchronous decision:

- New TypeScript source/tests in the current working diff: **1,833 lines**.
- Added/deleted lines in modified tracked TypeScript, excluding generated clients:
  **359 lines**.
- Current non-generated source review surface: **2,192 lines**, including both sides
  of reader/test moves. Generated OpenAPI/client files and prose are excluded.

The following are **engineering estimates**, not measured implementation totals. They
use the same review-surface convention, counting moved source on both sides:

| Additional work | Estimated changed source/test lines |
| --- | ---: |
| Pending schema/grants/guards, acceptance/outbox, polling/query coverage and API test conversion | 700–900 |
| Worker orchestration, storage/read adapters, BullMQ transport/lifecycle and retry/isolation/race tests | 1,000–1,300 |
| Shared hardened parser and pure-money extraction, compatibility facades, boundary/build changes and regression coverage | 900–1,200 |
| **Estimated additional review surface** | **2,600–3,400** |
| **Estimated total, before generated files/prose** | **4,792–5,592** |

That is above twice the measured current surface (**4,384 lines**), approximately
**2.19–2.55 times** the current slice. Accordingly, the original attempt stopped before asynchronous runtime/schema
implementation. The manager has since approved the split; 47-1a is now executing. These estimates must be checked again against the actual diff in each PR.

## 47-1a — request acceptance, schema and polling

One API command: request a package-import preview. One PR.

1. Widen the existing status CHECK with `pending`, scoped to package previews; preserve
   the staff default `ready` and existing committed/failed consistency checks. Reuse
   existing columns where their semantics fit. Pending rows start with zero counts
   and empty results. Keep permission seeding and this schema/grant change in the same
   unnumbered 47-1a migration draft until `lane granted`.
2. Add `PackageImportPreviewRequested` with `{ preview_id }` only. Tenant identity comes
   from the outbox envelope; business, creator and file come from the stored preview.
3. Replace synchronous preview execution with acceptance: check permission, orders
   feature and file facts; insert pending preview and outbox event in the same tenant
   transaction; return 202 `{ preview_id }`. Read no object bytes and run no parser.
4. Add a creator/company/business/entity-scoped polling query and GET contract. Unknown
   and inaccessible previews share one refusal. Pending carries no row results; ready
   returns bounded counts/errors/skipped count; failed exposes a named safe error.
   Decide the durable skipped-count representation in this schema change so 47-1b
   does not need a second incompatible result schema.
5. Preserve `@Require('import:packages:business', { business: 'businessId' })` and
   `@RequiresFeature('orders')` on request, template and polling. Extend route coverage,
   OpenAPI and generated clients. Keep owner/GM/BM defaults and device denial.
6. Tests: atomic preview/outbox creation and rollback; id-only payload; no workbook
   access at acceptance; cross-tenant/business/creator polling negatives; device and
   feature denial; pending-state and update-grant negatives; query DTO and EXPLAIN;
   one warm-up plus five full acceptance calls with median <200 ms.

**Producer rollout fence:** 47-1a must not mount/enable the new request route in the
production controller list before 47-1b supplies its worker transport. Test the route
through the test composition root. 47-1b performs the production mount only together
with its supported event/transport lifecycle. Polling must still refuse foreign or
unknown IDs. This avoids publishing a durable command with no available consumer and
does not require a new product feature flag or environment secret.

The current package row plug-in and money changes belong in 47-1b's diff, rather than
shipping unused parsing code in 47-1a. Retain the current reviewed work locally; do not
delete it or mix both PRs' changes when preparing 47-1a.

## 47-1b — worker preview execution and activation

Depends on 47-1a's accepted schema/contracts; one worker use case and one PR.

1. Extract the hardened workbook implementation to a shared technical workspace
   surface. Keep `apps/api/src/shared/import/xlsx-sheet-reader.ts` as a compatibility
   facade and retain staff's constants/error mapping. Record the extraction in the
   architecture ADR and boundary configuration. Reuse the existing pinned ExcelJS/SAX
   versions; do not put I/O or dependencies into the zero-dependency domain package.
2. Share the pure allocation/definition/slot primitives and their error identity without
   cross-app imports or copied business rules. Keep API compatibility exports, preserve
   the default sale behavior and import all domain code only through permitted inward
   dependencies. Finalize this extraction design with the independent Astra review.
3. Worker sequence: load pending preview and verified file facts under the tenant;
   release transaction; read bounded object bytes and parse outside provider-holding
   transactions; enter `withTenant`, lock the preview, recheck pending state/file identity,
   resolve services/refs/customers in batches, and atomically save safe rows/errors and
   ready state. Validation row errors produce a ready preview with errors; permanent
   workbook failures produce failed with a stable code. No full phone may reach rows,
   payloads, audit, responses, logs or propagated database errors.
4. Duplicate jobs/events and races must leave terminal ready/failed previews unchanged.
   Retry infrastructure failures; on the final attempt conditionally mark only pending
   previews failed. No provider call while a tenant transaction is open. No entitlement,
   financial event, package-import commit or commit-recovery sweep is added.
5. Bind the id-only event to BullMQ outside the outbox claim transaction, register its
   known type only with the real consumer, and include ready/close lifecycle hooks.
   Mount the API request producer only in this completed activation layer.
6. Tests: real worker execution over the full 500-row/20-group workbook; privacy and
   exact money totals; expired dates; unknown/ambiguous services; existing and duplicate
   refs; malformed input; storage outside transactions; repeated/concurrent delivery;
   rollback, terminal failure and infrastructure retry; tenant isolation; lifecycle and
   transport delivery failure. Re-run the reader/staff compatibility suite and retain
   47-1a's <200 ms acceptance assertion.

## Ownership and gates

Each PR gets the local PP-113 checks, clean-code-guard/test-guard/docs-guard and a fresh
read-only Astra medium review with P0–P3 resolved before PR creation. Full suites/API
shards stay in CI. No migration number, final `db:generate` or push before the manager's
explicit lane grant. Shared files are rebased and regenerated; never hand-merged.
No merge, deployment, real env or server/secrets change is authorized.

47-2 remains **financial import commit only**, with its own commit worker/event/recovery
after the complete asynchronous preview is available. The 47-1b preview worker is the
specific exception authorized by the manager's 16:03 decision.

**Current next step:** finish 47-1a request/polling, private-cluster migration tests and
Astra review; report readiness for the lane. Production registration stays absent
until the real 47-1b consumer lands. Start 47-1b only after 47-1a merges.
