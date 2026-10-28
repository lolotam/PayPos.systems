# Plan 56-1: commission statement Excel export (spec 059, D-18, FR-050…FR-052, CM-R10)

Planner lane, docs only. Base: `main` 46a0e462 (2026-10-28). Risky: tenant table, migration, RLS, money-adjacent data.

## 1. Row 56-1 is three use cases: split

Row 56-1 (spec.md:1180) holds (1) the export table and the request use case, (2) the worker source and the workbook
builder, (3) the collect route, its re-check and the audit. That is three PRs (CLAUDE.md §1). The attendance statement
was split the same way: 27g-3 worker (#684), then 27g-4 API (#697).

| Sub-PR | Result | Blocked on |
| --- | --- | --- |
| **56-1a** | `commission_statement_exports`: migration, RLS, grants, guard, negative tests, the kind constant. No behaviour | no unmerged PR (48a-2 #650, 56-0 #651 merged); CS-Q33 decides one column (§12) |
| 56-1b | Worker source (loads the row by render id, filters every frozen row by the saved `branch_ids`, FR-050) and the `exceljs` workbook builder in `packages/documents` (FR-051, CM-55, CM-55b, CM-55f, CM-56) | 56-1a; CS-Q33, CS-Q34 (§12) |
| 56-1c | Request, poll and collect use cases, HTTP, collect re-check, audit `commission_statement.exported` (FR-050, FR-052, CM-55d, CM-55e, the export part of CM-23d…h) | 56-1b; **50-5** (`read:commissions:business` and the effective-branch-set reader _R_, D-16) and **53-2** (approval) |

Evidence that 56-1b/c cannot start now: `git log` on main has 48a-1, 48a-2, 48-1, 50-0, 50-a and 56-0, but not 50-5,
51-1, 52-1 or 53-2. `read:commissions:business` is not in `packages/db/src/access-catalog.ts` (only
`manage:commission-plans:business`, line 67). No _R_ resolver exists in `apps/api` or `packages/db`. 56-1b tests seed
frozen rows through `packages/db/test/commission-statement-fixtures.ts`, as 48a-2's tests do.

**This plan covers 56-1a only.** 56-1b and 56-1c each get their own scoped plan. spec.md row 56-1 is left unchanged in
this docs commit. If the orchestrator accepts the split, the docs PR adds a one-line pointer there.

## 2. Migration number

Queue checked 2026-10-28: `_journal.json` ends at idx 187 (`0187_2026-10-25_commission-plans-permission`), and
`gh pr list --state open` returns `[]`. 58-2b keeps its historical **0188** (plan-58-2-split.md:84). 56-1a reserves
**0189**, after 58-2b in the expected merge order (agent-delivery-pipeline.md §13). Numbers become final at merge. 58-2b
still needs its own plan. File: `packages/db/migrations/0189_<UTC date>_commission-statement-exports.sql`, then the
RLS, grant and guard SQL appended by hand in the same file (the 0182/0183 shape).

How the number is produced. drizzle-kit numbers from the journal, so `pnpm db:generate commission-statement-exports`
on today's main emits `0188_…`, `meta/0188_snapshot.json` and journal entry idx 188. Rename both files to `0189` and set
the entry's `idx` and `tag` to match. The runtime migrator reads files by journal `tag`
(`readMigrationFiles`, `packages/db/src/concurrent-migrations.ts:352`), so the gap at 188 should be harmless.
**Verify** this on the lane: a fresh `migrateDatabase` applies 0189, and `pnpm db:generate` reports no drift.
Final at merge (§13):
- If 58-2b merges first, 56-1a deletes its generated SQL and snapshot, rebases, re-runs `pnpm db:generate` (the
  snapshot's `prevId` then points at 0188) and re-appends the hand-written SQL.
- If 56-1a merges first, it is renumbered to **0188** the same way before merge, so main never carries a gap. 58-2b then
  generates 0189.

Either way the second migration to merge must be regenerated after rebasing, never just renamed. The migrator applies
only entries whose `when` is newer than the last applied one (`concurrent-migrations.ts:336`), so an older `when`
would be skipped silently on staging.

## 3. Table `commission_statement_exports` (CM-R10)

| Column | Type | Note |
| --- | --- | --- |
| `company_id` | uuid NOT NULL | FK `companies(id)` |
| `id` | uuid NOT NULL | the row id; PK `(company_id, id)` (ADR-0007) |
| `render_id` | uuid NOT NULL | the ADR-0049 job's `render_id` (`{ company_id, render_id, kind }`); `UNIQUE (company_id, render_id)` as the spec's §6 row states (T1, PP-74.4) |
| `business_id` | uuid NOT NULL | not in the §6 row; needed for the composite FK below |
| `statement_id` | uuid NOT NULL | |
| `period` | char(7) NOT NULL | same CHECK as `commission_statements_period` |
| `requested_by` | uuid NOT NULL | FK `"user"(id)` |
| `requested_membership_id` | uuid NOT NULL | FK `(company_id, requested_by, requested_membership_id)` → `memberships(company_id, user_id, id)` (0183 `reviewed_membership_fk`) |
| `scope` | text NOT NULL | CHECK `IN ('BUSINESS','BRANCHES')` |
| `branch_ids` | uuid[] NULL | the reader's whole _R_; no FK on array elements (in the spec) |
| `employee_ids` | uuid[] NULL | from the frozen `EMPLOYEE` rows overlapping _R_; may be empty |
| `language` | text NOT NULL, CHECK `IN ('ar','en')` | CS-Q33 option 1, Waleed's card pick (2026-10-28, batch 79); Abu Salem's pick still pending (§12) |
| `requested_at` | timestamptz NOT NULL | no default; the use case passes `Clock` (0182) |
| `collected_at` | timestamptz NULL | the only column the app may update |

- FK `(company_id, business_id, period, statement_id)` → `commission_statements(company_id, business_id, period, id)`
  (the existing `commission_statements_period_id_key`), so `period` can never disagree with the statement.
  FK `(company_id, business_id)` → `businesses`.
- CHECKs: `(scope = 'BRANCHES') = (branch_ids IS NOT NULL AND employee_ids IS NOT NULL)`;
  `branch_ids IS NULL OR cardinality(branch_ids) > 0`; `array_position(branch_ids, NULL) IS NULL` and the same for
  `employee_ids` (no NULL element).
- **Two guards** (T2, PP-74.4), each `SECURITY INVOKER`, `search_path = pg_catalog, public`, FOR EACH ROW:
  `commission_statement_exports_insert_guard()` BEFORE INSERT: the referenced statement's `status IN ('APPROVED','PAID')`
  (CS-Q10 backstop) and `collected_at IS NULL`; `commission_statement_exports_update_guard()` BEFORE UPDATE: only
  `collected_at` changes, only NULL → non-NULL (collect once, CM-55e). Each raises `23514` with its own named
  constraint, in the 0183 style. The use case checks the status first and throws a typed error, so the
  trigger is only the backstop for a broken invariant (CLAUDE.md §5, PP-7.2).
- RLS: `ENABLE` + `FORCE`; policies `_select`, `_insert` (WITH CHECK) and `_update` (USING + WITH CHECK), all
  `company_id = app_company_id()`, `TO pospay_app`.
- Grants: `REVOKE ALL … FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher`; `GRANT SELECT, INSERT` and
  `GRANT UPDATE (collected_at)` to `pospay_app`; for each guard, `REVOKE ALL ON FUNCTION … FROM PUBLIC` and
  `GRANT EXECUTE` to `pospay_app`. No DELETE: the request row is the record of who exported which scope.
- Indexes (every FK and the known reads): `(company_id, business_id, period, statement_id)`;
  `(company_id, requested_by, requested_at)`; `(company_id, requested_by, requested_membership_id)`; `(requested_by)`.
  The worker reads by the `(company_id, render_id)` unique index. No GIN index: nothing filters on this table's arrays.

## 4. Contracts (56-1a part only)

`packages/contracts/src/commissions/statement-exports.ts`: `COMMISSION_STATEMENT_EXPORT_DOCUMENT_KIND =
'commission-statement-xlsx'` and `commissionStatementExportScopes = ['BUSINESS','BRANCHES']`.
`documents-render.ts` keys `documentBytesKinds` by the constant, with an unchanged value. Request and response schemas,
the poll shape and OpenAPI paths ship with the routes in 56-1c, because the request body depends on CS-Q33.

## 5. Not in 56-1a, by construction

No use case, no `queries/` file (so no EXPLAIN or result-shape test), no HTTP route or guard, no outbox event, no
idempotency key, no money column (bigint mills is decided in 56-1b: CM-56 "text-safe numbers" is an `exceljs` cell-type
decision), no i18n, no UI. `exceljs` is still only in `apps/api/package.json`: 56-0 did not move it, so 56-1b adds it to
`packages/documents`. 56-1c gates admission on `documentKindNeedsRenderer(kind)`, unlike the attendance request, which
calls `rendererAlive()` unconditionally.

## 6. Exact write scope for the implementer (MiniMax)

Create:
- `packages/db/migrations/0189_<date>_commission-statement-exports.sql`
- `packages/db/migrations/meta/0189_snapshot.json` (generated)
- `packages/db/schema/commissions-statement-exports.ts`
- `packages/db/src/__tests__/rls-commission-statement-exports.spec.ts`
- `packages/db/src/__tests__/commission-statement-export-constraints.spec.ts`
- `packages/contracts/src/commissions/statement-exports.ts`
- `packages/contracts/src/commissions/__tests__/statement-exports.spec.ts`

Edit:
- `packages/db/migrations/meta/_journal.json` (generated entry)
- `packages/db/schema/index.ts` (one export line)
- `packages/db/test/commission-statement-grants.ts` (add `commission_statement_exports:INSERT`, `:SELECT` to the table
  list and `commission_statement_exports.collected_at:pospay_app:UPDATE` to the column list)
- `packages/db/test/tenant-table-inventory.ts` (one entry)
- `packages/db/test/function-inventory.ts` (the two guard functions)
- `packages/db/test/commission-statement-fixtures.ts`, only if a helper that inserts an export row is needed
- `packages/contracts/src/documents-render.ts` (key by the constant) and `packages/contracts/src/index.ts`

Nothing else. No `git stash`, no commits or pushes, no reformatting of other files, no scratch databases, no edits in
`apps/`. One-line Arabic doc comments on the schema columns that are not self-evident (`id` = render id, `scope`,
`render_id`, `scope`, `branch_ids`, `employee_ids`), on the grants file and on each guard, commenting the why (CLAUDE.md §3.1).

## 7. Tests (all against a real Postgres, ADR-0006)

- `rls-commission-statement-exports.spec.ts` (CM-R10): company B reads 0 of A's rows; an insert with A's `company_id`
  under B fails; B's UPDATE of A's `collected_at` touches 0 rows; `relforcerowsecurity` is true.
- `commission-statement-export-constraints.spec.ts`: a bad `scope`; `BRANCHES` without arrays; `BUSINESS` with arrays;
  an empty `branch_ids`; a NULL element; a `period` that differs from the statement's (FK violation); a statement of
  another business; a membership of another user; an insert for a DRAFT or REVIEWED statement fails, for APPROVED and
  PAID it passes; a second row with the same `(company_id, render_id)` fails (`23505`), the same `render_id` in
  another company passes; an insert with `collected_at` set fails; `collected_at` set twice or back to NULL fails; an UPDATE of any
  other column is denied by privilege (`42501`).
- `privileges.spec.ts` and `function-inventory.spec.ts` pass with the new allowlist entries, and fail without them.
- Contracts: the kind is a bytes kind with the xlsx MIME type and `documentKindNeedsRenderer` is false.

## 8. Local gates (the orchestrator reruns them, PP-10.1)

From the 56-1a worktree root, after copying `.env` from the main checkout:

```sh
node scripts/test-db/lane.mjs up <lane>
pnpm install --frozen-lockfile
pnpm --filter "@pospay/db^..." build
pnpm --filter @pospay/db exec vitest run src/__tests__/rls-commission-statement-exports.spec.ts \
  src/__tests__/commission-statement-export-constraints.spec.ts src/__tests__/privileges.spec.ts \
  src/__tests__/function-inventory.spec.ts src/__tests__/rls-commission-statements.spec.ts
pnpm --filter @pospay/contracts test
pnpm check
node scripts/test-db/lane.mjs down <lane>
```

`pnpm check` is the merge gate (#701: CI runs the full workspace check before merge).

## 9. Points for Astra's read-only design advice

1. T1 (decided, PP-74.4: as the spec states): a separate `render_id` column with `UNIQUE (company_id, render_id)`.
2. T2 (decided, PP-74.4: as the spec states): two guard functions, one for INSERT (statement APPROVED or PAID,
   `collected_at` NULL) and one for UPDATE (only `collected_at`, once). Is the status read inside the insert guard safe
   without a lock? An approved statement never returns to
   DRAFT or REVIEWED (`commission_statements_update_guard`), so it should be.
3. Whether `employee_ids` should also refuse being empty when `scope = 'BRANCHES'` (the spec only limits `branch_ids`).
4. The index set: is `(company_id, requested_by, requested_membership_id)` worth keeping beside
   `(company_id, requested_by, requested_at)`?

## 10. Risks

- 58-2b and 56-1a both add a migration; whichever merges second rebases its number (§13). They touch different tables
  and files, except `_journal.json` and the `test/` inventories, which merge cleanly as separate lines.
- 56-1a ships the `language` column on Waleed's CS-Q33 pick. If Abu Salem later picks option 2 or 3, his pick binds
  and a follow-up expand/contract migration drops or relaxes the column.
- The guard reads `commission_statements`, so a future change of statement statuses must update both triggers.

## 11. Out of scope

The workbook, the worker source and the `exceljs` dependency (56-1b); the routes, use cases, permission, _R_, rate limit,
file name and audit (56-1c); the screen button (53-3); customer erasure (D-21, deferred).

## 12. Open questions

Both are recorded in `owner-questions.ar.md` (### 33, ### 34) and published on the decisions page as batch 79.
Waleed picked the recommended option of each by card on 2026-10-28; work proceeds on his picks until Abu Salem answers,
and Abu Salem's pick binds on a difference (CLAUDE.md §1 5b).

- **CS-Q33 — workbook language (BUSINESS: product behaviour).** FR-051 (spec.md:910) lists columns and no language. The
  frozen rows hold `employee_name_ar`/`_en` and `service_name_ar`/`_en`. Precedents were owner questions: ST-Q4 (spec
  061:77, language chosen at download) and AB-Q9e (spec 049:56, CSV in Arabic). Options: (1) chosen at download, stored in
  `language` ⭐; (2) always Arabic; (3) bilingual headers. Blocks only the `language` column of 56-1a, and 56-1b.
- **CS-Q34 — payable figure of a cash-paid statement (BUSINESS: money).** CS-Q12 names 56-1 as a waiting row
  (owner-questions.ar.md, ### 12), but FR-051 says only "net payable figure" and CM-56 (spec.md:494) requires the frozen
  amounts bit for bit. The rounded amount lives on 54-1's payment record (D-19). Options: (1) exact net, plus a "paid in
  cash" column with the rounded amount when paid in cash ⭐; (2) exact only; (3) the rounded figure replaces the net.
  Blocks 56-1b only.

T1 and T2 (§9) are technical and went to Waleed only. He chose the spec's literal shape over this plan's first
defaults (PP-74.4, 2026-10-28); §3 follows his answer.
