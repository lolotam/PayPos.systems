# 47-2a — إثبات تقسيم صفوف معاينة استيراد الباقات

Base: main 3fc65c26. One use case: strengthen ExecutePackagePreview. Close #875 and #876.
The manager granted the migration lane after 0212; do not change 0211 or 0212.

## Binding PP-134

Technical, direct PP-117, Waleed, 2026-11-06; manager relay 09:23 Kuwait.
Question: المعاينات القديمة اللي معندهاش إثبات تقسيم الصفوف (valid/invalid/skipped) ينفع تتعمل commit؟
Options: (1) «نرفضها ونطلب معاينة جديدة (المقترح)» (2) «الـ worker يعيد قراءة الملف ويبني الإثبات».
Answer verbatim: «سوال المعاينة القديمة نرفضها ونقبل معاينة جديده».
Record this exact decision in owner-questions.ar.md and owner-decisions.ar.md (PP-134), not the decisions site.

## Scope and acceptance

- Persist nullable source_rows and skipped_rows ordinal arrays on import_previews. NULL means legacy/no proof;
  do not backfill or reread files. Non-package entities keep existing behavior.
- ExecutePackagePreview supplies all physical source row ordinals and skipped ordinals in its existing ready
  transaction. Keep valid/invalid metadata, errors, phone privacy, bounds, timing and idempotence unchanged.
- New worker results carry a proof: unique integer source ordinals, count=row_count, valid row IDs
  unique, invalid row IDs distinct for partition purposes (multiple errors per row allowed), skipped row IDs
  unique with count=skipped_count. Each set is a subset of source_rows; pairwise disjoint; their union equals it.
- Preserve every 0212 trigger refusal. Proof is immutable after ready and only written by pending-to-ready.
  0213 is expand only: both columns NULL are accepted for old-worker rollout and one-click rollback;
  partial or malformed proof is refused. After the 47-2a worker is deployed on staging, 47-2b's contract
  migration will require proof and enforce PP-134 in the commit guard with IMPORT_PREVIEW_EXPIRED.
  No contract or commit route/use case is implemented here.
- New migration only, expanded nullable columns, narrow column UPDATE grants if necessary, app-role tenant
  isolation tests and negative DB guards. Any new CHECK uses NOT VALID and separate VALIDATE statements.
  No fabricated proof for legacy data; existing rows must migrate without data mutation.
- Report IMPORT_REQUIRED_CELL separately for each missing service_N/sessions_N/remaining_N cell in a populated
  group; an entirely empty group stays ignored. INVALID_CELL is reported only by checkCells, not as missing.
  Reuse original rules, preserve source numbering.
- Regression coverage: omitted/overlapping/duplicate/foreign ordinals, malformed arrays/types, invalid numeric
  aliases, multi-error one row, old worker NULL-proof compatibility, proof immutability, staff unaffected,
  negative cross-tenant writes and reads, full 500-row/20-group workload and the slice API regressions.

## Fences

No 47-2b/c/d, financial writes, producer activation, event registration, server, secret or env-file changes.
No changes to customer lookup, sell-package, record-service-session, append-service-session-lines,
cancel-redemption, existing migrations, workflows or unrelated formatting.
Implementer performs source edits/tests only; no git writes, installs, db:generate, push, PR or review requests.
Keep migration SQL as an unnumbered draft for the parent to generate with the granted lane and inspect.
Read CLAUDE.md, CLAUDE.architecture.md, AGENTS.md, the pipeline and spec058 first. Parent owns gates and PR.

## Generated delivery

The parent generated `0213_2026-11-06_package-preview-partition-proof.sql` after 0212
under the granted lane. Its snapshot changes only the two nullable proof columns;
prevId chains to 0212 and journal idx is 213. There is no backfill, data UPDATE,
new CHECK or table-validation scan. Every old 0212 refusal is preserved; only the
pending result-column allowlist expands for the proof. The `zz_` trigger order
ensures the retained result-shape checks run before proof casts. Both NULL arrays
are accepted for old-worker rollout and rollback; supplied proof is fully checked.
Legacy ready-to-commit_requested behavior is unchanged in 0213. Requiring proof
and PP-134's commit refusal belong to 47-2b after the new worker is deployed.
No financial state transition is opened here.
