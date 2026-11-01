# 49-1 — final initial HTTP and list stage

Continue the same initial MiniMax delivery. The lead verified contracts, private storage, the reset resolver and
the transactional writer. See plan-49-1.md for receipts and corrections. Finish the HTTP/list/root-binding stage
inside the same eventual 49-1 PR. The manager granted the lane at 16:06 Kuwait on 2026-11-01, after #757 merged.
The lead may publish after final four-kind correction, generation and validation; the implementer does not publish.

## Required reading and operating limits

Read AGENTS.md and its governing documents, docs/agent-delivery-pipeline.md, plan-49-1.md, the accepted contracts,
brief-49-1-implementation.md, the current writer/scopes, commission-plan-versions.controller.ts and query, app.ts,
commissions.module.ts, staff/index.ts and persistence/lock-employee.ts. Read ADR-0054 section 4 and module-map section
3. Read staff's query-local EmployeeAppLinkNames pattern and orders/queries/service-line-edits.query.ts for scoped,
canonical base64url cursor validation; do not import either module into commissions.

Before editing read the installed skills under:
C:/Users/waleed_Mohamed/.agents/skills/synced/a49607e8-f54e-4100-93e1-44bf20defa51_62361cb6-49ad-4012-a8bf-6b998ea4eb23/

- pospay-code-rules/SKILL.md
- pospay-nestjs-module-shape/SKILL.md
- pospay-api-endpoint/SKILL.md
- pospay-kwd-money-and-i18n/SKILL.md

These skill files are the only outside-worktree reading exception. File read/edit only. No commands, shell, git,
scripts, tests, network, MCP, delegation, .env*, .git, secrets, commits, publication or server actions. The lead
checks the child's actual git root and reads every change before executing anything.

## Verbatim constraints

> Contracts live in `packages/contracts` (Zod). Controllers use them for validation; frontends import the types. No hand-written duplicate types.

> **Read endpoints go through `queries/`, not through use cases.** A `queries/` file may not import `domain/` or `use-cases/`, and may never write.

> **Every `queries/` file has a result-shape test and an `EXPLAIN ANALYZE` assertion.**

> **Guards keep a connection budget.** Every guard transaction holds a pool connection, so a guard never opens a transaction inside another one, never runs two at once, and merges the reads that can share one `withTenant(companyId, tx => …, { userId })` transaction into it instead of opening a second one (PP-7.2).

No UI, estimate endpoint, permission seed, event, new dependency, generic framework, pricing calculation, schema or
migration change. Do not modify accepted contracts, generated clients, engine, writer production code or existing
48-2 test assertions. Report any essential outside-scope edit before touching it.

## Exact write scope

Paths are relative to apps/api/src/modules/commissions unless explicitly rooted elsewhere:

1. http/commission-service-overrides.controller.ts (new).
2. http/commission-input-errors.ts (new shared write-error mapper).
3. http/commission-plan-versions.controller.ts (use that mapper, preserving all behavior).
4. queries/commission-service-overrides.query.ts (new query-local interface, token and list statement/execution).
5. queries/commission-service-override-cursor.ts (new private cursor helper if needed).
6. persistence/commission-service-override-list-readers.ts (new same-Tx callback adapter).
7. commissions.module.ts (wire both use cases, the new controller and query factory).
8. apps/api/src/app.ts (root bindings through provider index exports only).
9. apps/api/src/modules/staff/persistence/employee-exists.ts (new narrow read).
10. apps/api/src/modules/staff/index.ts (export employeeExistsInBusiness).
11. apps/api/test/harness.ts (export the new staff reader for test-root bindings; no unrelated rewrite).
12. __tests__/commission-service-overrides.fixture.ts (extend with HTTP/list helpers and reader bindings).
13. __tests__/commission-service-override-http.spec.ts (new).
14. __tests__/commission-service-override-access.spec.ts (new).
15. __tests__/commission-service-override-queries.spec.ts (new).
16. __tests__/commission-service-override-pagination.spec.ts (new).
17. __tests__/commission-service-override-explain.spec.ts (new).
18. __tests__/commission-service-override-cursor.spec.ts (new if needed).
19. apps/api/src/modules/staff/__tests__/employee-exists.spec.ts (new).

The parent owns docs/module-map.md, generated YAML and ADR-0054 updates. Report the exact implemented interface and
binding shapes so the parent adds the corresponding Port rows and verifies whether reads entries are needed.
The commissions -> staff arrow already exists. Callback-only root bindings need no new reads entry under ADR-0054
section 4; do not import staff/catalog/tenancy values from inside commissions. Do not edit documentation yourself.

## Root boundaries

staff owns employeeExistsInBusiness(tx, companyId, businessId, employeeId), with company/business/id predicates and
deleted_at IS NULL, no lock. Export it from staff/index.ts; no direct employees-table query is added to commissions.
Test real existence, deleted/missing employees, wrong business and wrong company on a cloned database.

Define OverrideListReadsFactory beside the list query, supplying access(companyId,userId,businessId),
timeZone(companyId,businessId) and employeeExists(companyId,businessId,employeeId) on its captured Tx.
Before reading employee or override data, recheck permission and feature through identity.readCommissionPlanListAccess,
an unlocked reader sharing the writer's access evaluation while preserving the writer's existing locks.
The adapter receives provider callbacks; app.ts binds the other reads to tenancy.businessTimeZone and
staff.employeeExistsInBusiness. Query imports no write ports,
domain, engine or use case. HTTP injects only the query-local factory and calls it on its existing withTenant Tx.
If an adapter returns an inferred structural shape, the module's binding must check it against the query factory;
do not import queries into persistence against the layer matrix to add an unnecessary annotation.

Bind the writer's serviceReader at app.ts to readSessionServices(tx, companyId,businessId,[serviceId]).length > 0,
alongside businessCalendar, lockEmployeeForUpdate and readCommissionPlanAccess. It checks existence only. Bind
concrete implementations in commissions.module.ts; preserve the original plan-version provider and Clock injection.
No cross-context JOIN and no second read transaction. No new module public exports for a use case or repository.

## HTTP behavior

POST and GET /v1/businesses/:businessId/employees/:employeeId/commission-overrides, exactly the accepted OpenAPI
contract. Both use manage:commission-plans:business and RequiresFeature('commissions'); only individual admin
principals pass. POST requires Idempotency-Key and returns 201. Path IDs follow the existing lowercase convention.
Bodies and queries use their accepted strict Zod schemas. Delegate writing to CreateCommissionServiceOverrideUseCase.

Share the existing write-error mapping with the plan-version controller: typed domain error -> ApiError, statement
closed -> COMMISSION_PERIOD_CLOSED, mismatch -> 422 IDEMPOTENCY_KEY_REUSED, busy -> 409 IDEMPOTENCY_KEY_IN_PROGRESS.
Import the domain error through its existing use-case export, not directly from domain in HTTP. Preserve unexpected
errors. Read errors are narrow query-owned errors mapped to known API codes, without exposing decoded cursor data.

GET returns saved fields plus is_current and next_cursor; optional service_id and bounded pagination remain as
contracted. Missing/deleted/wrong-business employee is 404 EMPLOYEE_NOT_FOUND. No write, audit, statement creation
or engine invocation occurs on this read. Missing root readiness follows the established NOT_READY behavior.

## Query and cursor

Select only commission_service_overrides; callback reads supply provider-owned existence and timezone. Compute the
business-local date from PostgreSQL CURRENT_TIMESTAMP and the supplied business timezone inside the same read Tx.
This gives a stable transaction date without importing a write Clock port. Tests deriving date-sensitive seeds
should seed and read within one transaction where possible, avoiding assumptions about the developer's wall clock.

Sort service_id ASC, created_at DESC, id DESC. A row is current iff effective_from <= business today and no eligible
same-company/business/employee/service competitor has a greater (created_at,id). Use correlated NOT EXISTS. Do not
filter competitors by the page cursor. A future override does not supersede today's winner. Only the four agreed
kinds are accepted (final CS-Q39 decision). Do not choose by greatest effective_from or add predictive statuses.

Keyset next page: greater service_id OR same service_id and smaller (created_at,id). Preserve raw UTC microseconds
using to_char with US for cursor time. The API created_at response uses MS as before; never derive the cursor by
Date parsing, epoch milliseconds or the response timestamp. Same-millisecond rows must not disappear or repeat.

The canonical base64url cursor carries version, tenant/business/employee/filter context and the service/time/id
position, within the existing 512-character bound. Validate decoded shape, IDs and real UTC timestamp before SQL;
invalid, noncanonical, wrong-context or wrong-filter cursor -> known 400 VALIDATION_FAILED, never a raw PG 500.
No token signing or new public cursor schema is needed. Query values remain bound parameters.

SQL projects rule into the response shape: PCT value is integer bps; FIXED value is exact numeric text; other kinds
have no value. Parse final DTOs with the accepted contract; do not leak internal microsecond cursor columns into
strict responses. Do not import the persistence writer mapper into queries.

## Required proof

- HTTP happy path and all four rule kinds, rejection of FOLLOW_SERVICE, strict invalid input/no whole_period, date errors, service/employee
  refusals, closed period, replay once, changed-body 422, missing Idempotency-Key 400 and busy 409 mapping.
- Uniform 403 on both routes for missing permission/disabled feature, a real device principal and other invalid
  principal kinds as the existing access machinery requires. GET and POST must not leak another tenant's data.
- Query DTO exactly matches the contract; no write/audit/statement side effect; missing/deleted employee, tenant and
  business ownership; optional service filter, empty and final pages, no duplicates/omissions across the whole list.
- Latest-created winner with an older effective date, future reset, equal created_at/id tie; current competitor
  outside the returned page; distinct microseconds inside one millisecond. Cursor retains the raw precise value.
- Malformed/corrupt/noncanonical/oversized/wrong-context/wrong-filter cursor -> 400 with no internal data exposure.
- EXPLAIN ANALYZE for filtered and unfiltered list shapes, proving the planned indexes can serve their predicates
  and ordering. Reuse the existing realistic seed/explain test style; no timing-based assertion or new index.
- Real staff-reader isolation and deleted-row proof. Keep every existing 48-2 test passing after the shared mapper
  and provider extension. Leave the engine imports inside its permitted layers when writing tests.

The lead runs scoped typecheck/lint/docs/module-map checks, the full relevant commissions suite, staff proof and
generated-artifact checks after reading the delivery. Nothing is run or claimed green by the child.

## Delivery

Return changed paths, actual tests authored, exact interface/root binding names for the docs, and unresolved
concerns. Explicitly state nothing executed. Do not commit; stop for the lead's review and final independent review.
