# 49-1 — private database draft brief

Continue the same initial MiniMax implementation. Contracts are accepted; this stage authors storage and its
isolation proof only. It is part of the same 49-1 delivery and eventual PR, not a second slice or clean application
handoff. The manager authorized this private draft on 2026-11-01 at 12:28 Kuwait. The migration lane still belongs
to 32b-pre-1. No push, PR, shared database, staging operation or final migration-number reservation is authorized.

## Required reading

Read AGENTS.md and its required project documents, docs/agent-delivery-pipeline.md, plan-49-1.md sections 1–4 and 8–9,
and spec.md FR-011–FR-013 and CM-R02. Read the installed skills before editing:

- C:/Users/waleed_Mohamed/.agents/skills/synced/a49607e8-f54e-4100-93e1-44bf20defa51_62361cb6-49ad-4012-a8bf-6b998ea4eb23/pospay-code-rules/SKILL.md
- C:/Users/waleed_Mohamed/.agents/skills/synced/a49607e8-f54e-4100-93e1-44bf20defa51_62361cb6-49ad-4012-a8bf-6b998ea4eb23/pospay-drizzle-tenant-table/SKILL.md

These two explicitly named installed skill files are the only outside-worktree reading exception. Do not read
.env*, .git, credentials or any other outside-worktree path. The lead, not the child, verifies the actual git root.

Use these existing patterns:

- packages/db/schema/commissions-plan-versions.ts and schema/catalog.ts (services).
- packages/db/migrations/0186_2026-10-25_commission-plan-versions.sql (existing inline RLS precedent).
- packages/db/src/__tests__/commission-plan-version-constraints.spec.ts and rls-commission-plan-versions.spec.ts.
- packages/db/test/commission-statement-fixtures.ts and commission-plan-version-fixtures.ts.
- packages/db/test/tenant-table-inventory.ts, table-grants.ts and commission-plan-version-grants.ts.
- packages/db/src/__tests__/privileges.spec.ts and test/test-database.ts.

## Verbatim project constraints

> Money: `numeric(14,3)` in Postgres; in TS **`bigint` mills (1 KWD = 1000)** or the `Money` type from `packages/domain` — **never `number`**.

> All tenant-data access goes through `withTenant(companyId, tx => …)` which sets `app.company_id` inside the transaction. **Exporting the raw Drizzle client from `packages/db` is forbidden** — modules receive `tx` only.

> **RLS negative tests for every tenant table** (cross-tenant read = 0 rows, write = error).

> **The orchestrator reads the delivered changes personally and runs the gates itself.**

The last sentence is the pipeline's delivery rule; all implementation remains file read/edit only. No command,
shell, git, network, MCP, script execution, test execution, delegation, commit or publication. Do not alter the
accepted contracts or any application/engine code. Do not weaken existing test inventories or assertions.

## Write scope

Only these paths may be changed or created:

1. packages/db/schema/commissions-service-overrides.ts (new).
2. packages/db/schema/index.ts (export the new schema).
3. packages/db/migrations/9999_2026-11-01_commission-service-overrides-rls.sql (new, unregistered RLS draft).
4. packages/db/test/commission-service-override-fixtures.ts (new).
5. packages/db/test/commission-service-override-grants.ts (new).
6. packages/db/test/table-grants.ts (include the new exact SELECT/INSERT grant inventory).
7. packages/db/test/tenant-table-inventory.ts (include the new tenant table).
8. packages/db/src/__tests__/commission-service-override-constraints.spec.ts (new).
9. packages/db/src/__tests__/rls-commission-service-overrides.spec.ts (new).

If a necessary change falls outside this scope, report its path and reason; do not edit it. Preserve the parent's
existing work. No edits to owner-question records, plan, briefs, existing migrations, migration metadata, scripts,
configuration, package manifests or lockfiles. Do not copy or hand-author a Drizzle snapshot or journal entry.

## Storage contract

Create the insert-only table commission_service_overrides, exported as commissionServiceOverrides:

| Column | Type and requirement |
| --- | --- |
| company_id, id, business_id, employee_id, service_id | uuid NOT NULL |
| rule_kind | text NOT NULL |
| rule_pct_bps | integer NULL |
| rule_fixed_amount | numeric(14,3) NULL; strings in TypeScript |
| effective_from | date NOT NULL |
| created_at | timestamptz NOT NULL; no database default, writer supplies injected Clock |
| created_by | uuid NOT NULL |

PK (company_id,id), company FK, business FK (company_id,business_id), employee FK
(company_id,business_id,employee_id), service FK (company_id,business_id,service_id), created_by FK to global user.id.
Reuse existing parent keys; do not modify employees, services, user or businesses.

Reuse the services column/check pattern with override names:

- Kind must be FOLLOW_PLAN, FOLLOW_SERVICE, ZERO, PCT or FIXED.
- PCT iff rule_pct_bps is non-null; bounds 0..10000.
- FIXED iff rule_fixed_amount is non-null; bounds 0..99999999999.999.
- FOLLOW_PLAN, FOLLOW_SERVICE and ZERO have both value columns null.
- Avoid a nullable CHECK whose UNKNOWN result admits an invalid shape. The kind column is non-null.

FOLLOW_SERVICE is an override-only valueless kind. Its application semantics are settled: when the winning eligible
override, return the line's saved snapshot from its effective date. Do not change ordinary catalog kinds here.
Do not add database date-vs-clock checks, eligibility rules or a trigger: past-date rejection belongs to the writer.

Indexes, and no speculative extras:

- (company_id,business_id,employee_id,service_id,created_at DESC,id DESC).
- (company_id,business_id,service_id).
- (created_by).

The first index covers the employee FK; the tenant-leading indexes cover RLS and the business/company FKs.

## Migration and grants

Author the RLS SQL at the 9999 placeholder path only. Do not register it; it must not be runnable on its own before
the table exists. Enable and FORCE RLS. Two policies only, SELECT/INSERT for pospay_app, with company_id scoped
through app_company_id(). REVOKE ALL from PUBLIC and all current runtime roles, including pospay_notifications;
grant only SELECT, INSERT to pospay_app. No UPDATE, DELETE, TRUNCATE or column-level write grants and no bypass.

The lead will review the schema and draft before running the repository db:generate wrapper for schema SQL, then
db:generate with --custom for its RLS entry. The lead transfers the reviewed RLS into that generated custom entry
and removes the unregistered 9999 draft. Generated sequential numbers in this private checkout remain placeholders,
not reservations. Final SQL and metadata are regenerated against main after the manager releases the lane.
No existing migration or generator is changed. A new table's indexes are created with its table; no concurrent
index operation on an existing populated table is needed.

## Required proof authored here

Use createTestDatabase's migrated template and cloned per-spec databases. Seed synthetic fixtures as owner and
exercise tenant operations through createDatabase/withTenant as pospay_app. Reuse existing fixture helpers where
their data fits; add services for each tenant and reuse/add the other-business service in the same company so the
service FK has a real wrong-business target. Do not test a nonexistent ID as a substitute for that case.

- Round-trip every valid kind, including both PCT bounds and zero/max FIXED as exact strings. Values for reset,
  plan and zero kinds must stay null. No numeric conversion of fixed money.
- Refuse unknown/null kind, missing/extra/wrong value columns, out-of-range bps, negative/out-of-range FIXED,
  missing required IDs/date/created_at/creator, and duplicate tenant PK. Assert PostgreSQL codes and named CHECK/FK
  constraints where deterministic. Do not assert rejection of PostgreSQL's native numeric scale rounding.
- Refuse an employee and a service from another business in the same tenant, and from another tenant; reject
  nonexistent creator and inconsistent business/company through the appropriate FKs.
- CM-R02: seed A and B; A can read its rows, B sees zero A rows, B cannot insert for A, and tenant context does not
  leak between transactions. Same UUID in different companies is permitted by the composite PK.
- Verify ENABLE/FORCE RLS and exactly the SELECT/INSERT policies. Prove app UPDATE/DELETE/TRUNCATE are refused and
  the previously stored row survives. Verify non-app runtime roles have no table privileges; keep the central
  exact grant inventory current so privileges.spec.ts independently verifies grants.
- Keep assertions independent of test order where practical. Use the current expectation helpers without weakening
  codes to catch-all success. Do not modify existing unrelated fixture rows or tests.

No EXPLAIN or application tests in this stage: the list query and write path do not exist yet. The lead will run
the scoped database proofs, privileges inventory, typecheck, lint and documentation guard after reviewing all files.
Do not claim any executed checks in your delivery.

## Delivery

Return changed paths, the invariants each test proves, and unresolved concerns. State explicitly that nothing ran.
Do not commit. Stop after this bounded stage; application/engine implementation gets a subsequent bounded brief.
