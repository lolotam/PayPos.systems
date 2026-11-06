# 47-2b — تثبيت استيراد الباقات في العامل

Base: main `f5ed030d0`. One use case: `CommitPackageImport` in the orders worker.
Manager confirms 47-2a deployed to staging at `16c6cd6f`, backup `e0036ad8`,
rollback/redeploy verified and worker readiness 200 (2026-11-06, 11:03 Kuwait).
No deployment is performed by this slice.

## Scope and hard fences

Implement financial commit only, plus the new contract migration. No API command,
controller, producer activation, event transport/consumer or recovery sweep: those
are 47-2c/d. No edits to migrations 0211/0212/0213, package sale/redemption use cases,
workflows, server or real env. The migration lane is held by #883 (0214). Keep SQL
as unnumbered drafts here; no db:generate, final number, commit, push or PR until
the parent coordinates the manager's explicit lane grant. Two consecutive numbers
are needed (expected 0215/0216 are provisional): draft A adds the nullable column,
NOT VALID FK, grant and guards; draft B starts with CREATE INDEX CONCURRENTLY,
then validates the FK in its transactional suffix. PP-136 advice confirmed the
runner cannot place concurrent DDL after ADD COLUMN in one entry; data steps are
not a DDL workaround. Existing rows keep NULL membership, without data mutation.

## Advisory decisions before implementation

PP-136 pospay-advisor and Astra high independently reviewed this design read-only.
Advice changed the initial plan as follows. These are technical implementation
choices within the assigned scope, not new business rules or owner decisions.

1. **Accepted identity.** Add a nullable `commit_membership_id` to import_previews,
   FK `(company_id,created_by,commit_membership_id)` to memberships' corresponding
   unique key, indexed on the child side. Only package ready-to-commit_requested
   may fill it, with status/requested_at, and it must then remain immutable.
   Future 47-2d supplies the selected authorized membership when accepting commit.
   The worker consumes that identity; it never chooses a live replacement or
   reauthorizes an accepted request. NULL is allowed on existing/unrequested rows;
   package requests without accepted identity are refused with a known import code.
   Scope this contract to packages; staff/customers keep their existing behavior.
2. **Service names.** Add a narrow catalog public reader for referenced service IDs,
   batched and locked in stable ID order on the same tenant transaction. No name
   rematching and no repricing. Names come from these services; money including
   list_price_snapshot remains from the validated safe preview. Missing references
   fail the whole commit with a safe known code.
3. **import_row.** Use the 1-based dense position of the physical row in sorted
   source_rows, before excluding skipped rows. Preserve the physical Excel row in
   proof. Do not use row-1: source 502 would yield 501, outside storage's 1..500;
   blank physical rows also make subtraction unsuitable. Test gaps and both bounds.
4. **Concurrency.** Insert entitlements in stable external_ref order with explicit
   `ON CONFLICT ON CONSTRAINT package_entitlements_external_ref_key DO NOTHING
   RETURNING`. Insert children only for returned parents. Do not swallow unrelated
   unique violations. Preview lock plus this conflict target protects replays and
   competing businesses of one company. Any other failure rolls back all writes.
5. **Audit.** appendAuditLog once with a valid lowercase action and safe counts,
   plus the distinct framework ImportCommitted outbox summary, in the same transaction.
   No PackageSaleChanged. Duplicate execution repeats neither. All-skipped is success
   with created_count=0. Freeze preview rows/errors/proof/skipped_count; total final
   skipped = row_count-created_count, not a mutation of the preview proof.
6. **Scale.** Do not introduce SQL UUID generation or reduce accepted file bounds.
   Generate UUIDv7 using the injected existing ID generator and write bounded batches
   below PostgreSQL parameter limits, inside ONE transaction. No global millions-of-
   slots array. Insert every component of a parent before its first slot. Reuse
   createPackageSlots with explicit base/last values. Benchmark the full 500*20*365
   = 3,650,000 slots including deferred checks through completed COMMIT, peak memory
   and timeout. Do not copy staff's 15-second transaction budget without measurement.
   Stop and report actual performance failure before changing any bound or atomicity.

## Worker and domain contract

- Read governing documents in AGENTS.md order, pipeline, spec058 FR-060..068 and
  IM-01..09, 47-1-manager-design, 47-1b-implementation, 47-2a-brief and ADR0034.
- withTenant locks the packages preview FOR UPDATE. Missing/other entity or state
  other than commit_requested is a no-op. app.user_id comes from the locked creator.
- Validate stored JSON with the project's Zod convention. Validate proof defensively,
  error-free preview, accepted membership and requested_at < expires_at in domain.
  No clock-time expiry after accepted request, file parsing, phone resolution or
  provider calls. Clock and UUID generator are injected.
- Pure domain builds records with bigint mills, explicit session-count allocation,
  exact conservation, remainder at the last slot of the last component. First
  original-minus-remaining ordinals are IMPORTED_USED, others FREE. Preserve group
  order while insertion order prevents external_ref deadlocks. No seller, payment,
  sale date or package type for IMPORTED.
- Success updates status/committed_at/created_count atomically with all package
  writes/audit/outbox. Failure after rollback only conditionally fails this entity's
  commit_requested row. Transient infrastructure errors remain retries; safe permanent
  errors are finalized without exposing source/provider/SQL data.

## Contract migration draft

- Nullable accepted membership column, narrow UPDATE grant, composite FK/index.
  Existing rows are untouched; any new CHECK uses NOT VALID then separate VALIDATE.
- Replace the existing update guard preserving all prior refusals except precisely:
  package commit_requested->committed changes status/committed_at/created_count;
  package commit_requested->failed changes status/error_code. Freeze accepted identity,
  result proof and terminal rows. ready->commit_requested changes only status,
  requested_at and the required accepted membership.
- Contract partition guard: package pending->ready requires both proof arrays;
  keep complete disjointness/coverage/types/count checks. PP-134 rejects legacy
  ready->commit_requested without proof as IMPORT_PREVIEW_EXPIRED. No backfill or
  workbook reread. Keep Waleed's recorded answer verbatim. Staff unaffected.
- The supported rollback floor after contract is the proof-writing 47-2a worker;
  rolling back to pre-expand 47-1b would fail mandatory proof. Document this explicitly.

## Verification and delivery

Tests: exact money/remainder/zero/used slots, sparse import_row, atomic rollback,
full-bound completed COMMIT/peak memory, duplicate jobs, all skipped, company-wide
ref races including reverse order and competitor rollback, invalid/legacy proof,
accepted identity FK/immutability, every prior guard negative, staff regression and
tenant/privilege negatives. Use real Postgres for persistence.

Implementer edits source, tests, schema and unnumbered SQL only. No dependency
install, env access/creation, git writes, generation, push or reviews. Parent sets up
the private lane with lane.mjs, applies the draft for local tests without committing
provisional migration metadata, runs PP-113 gates and obtains Astra high final review.
Full suite/API shards remain CI only. Parent owns final renumber/generate/push/PR.
