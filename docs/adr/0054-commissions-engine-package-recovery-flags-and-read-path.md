# ADR-0054 — The commissions engine package, the recovery-flag ledger, the read use cases and the two fingerprints

Status: Proposed (draft for spec 059, sub-PR 59-0; number provisional, renumbered at merge). Sections 1, 3, 4, 5 and 6 are decided by the spec and the design advisors; section 2's role choice is decided by the owners (CS-Q31: Waleed and Abu Salem, 2026-10-23, the recommended option, the existing `pospay_dispatcher`).
Date: 2026-10-22. Scope: spec 059, Phase 1 rows 48a to 56b. Owner decisions already taken: CS-Q13 = PP-17.1 (the new package), spec 059 D-6 to D-9, D-15 to D-18.

## Context

Spec 059 leaves four points to an ADR, and this is that ADR (sub-PR 59-0, docs only — no code, no migration, no lint change lands here):

1. **A new shared package.** The commission engine is pure TypeScript that lives today inside the API's commissions
   module, but the worker needs it too (the projection consumer). A package is the only way to share it without
   copying money rules (D-17, CS-Q13 = PP-17.1).
2. **A global operational table.** The reminder scheduler's loss must be recorded outside Redis (FR-053), and a table
   that no runtime role may clear is a different shape from the one the spec sketched.
3. **The read path of two use cases.** The estimate and the statement view must run the engine, and `queries/` may not
   import `domain/` (D-7).
4. **The fingerprints and the consumer id.** Two hashes with different inputs, one consumer id for six event types, and
   the rule that says which of the two an approval compares (D-6, D-8, D-9).

Everything else in this slice is already decided by the spec, by ADR-0003, ADR-0012, ADR-0041 and ADR-0049. This ADR
records the shape those decisions force, and records the one point the owners decided (CS-Q31, section 2).

## Decision

### 1. The package `packages/commissions-engine` (D-17)

**What it holds.** The pure engine that today lives in `apps/api/src/modules/commissions/domain/`: the plan types and
the plan validation (`validateCommissionPlan` in `plan-validation.ts`), the period computation (`computePeriod` in
`period-commission.ts`) with its helpers, and the plan-version selection (`selectCommissionPlanVersion` in
`plan-version.ts`). Sub-PR 48a-1 moves those files **unchanged**, with their tests. Sub-PR 50-a adds the input
assembly (FR-022), and the two pure fingerprint builders of section 6 live there too. ADR-0035 stands: commission kinds
stay out of `packages/domain`.

**Its dependency.** `@pospay/domain` only. The package follows the same purity rules as a module's `domain/`
(CLAUDE.architecture.md §3.1): no Drizzle, no NestJS, no Zod runtime, no `node:*`.

**Who may import it.** The root entry `@pospay/commissions-engine` only from the `commissions` modules of `apps/api`
and `apps/worker` — their `use-cases/`, `ports/` and `persistence/`, exactly the layers CLAUDE.architecture.md §3.1
lets import a module's own `domain/`, because the engine stands in for the commissions `domain/`. `events/handlers/`,
`jobs/`, `queries/` and `http/` never import it. The worker's `commissions`
module does not exist yet (it arrives with 50-1).

The ESLint rule for a module's `domain/` (`packages/config/eslint/boundaries.js`, the `**/modules/*/domain/**/*.ts`
block) allows only `@pospay/domain` and the folder's own relative files, so a commissions `domain/` file can **never**
import the package. 48a-1 therefore leaves `apps/api/src/modules/commissions/domain/` empty — everything in it today is
the engine — and changes no regex. Code that needs an engine type belongs in the package or in a use case.

**The subpath.** The package's `package.json` `"exports"` lists exactly `"."` and `"./validation"`, no wildcard.
`"./validation"` exports only `validateCommissionPlan`, its error codes and the plan types: browser-safe, no Node API,
no import beyond `@pospay/domain`. `apps/admin/src/commissions` (created by 48-3) may import `"./validation"` and
nothing else of the package, so the builder screen runs the same validator as the API (CM-06).

**Addendum (2026-11-20, 48-3 PR 1; Waleed's size answer and the Astra debate, spec 059 owner-questions §52).** The API
receives a plan in the contract's wire shape (KWD strings, `package_sale`) and the validator takes the engine's shape
(`bigint`, `packageSale`). Until 48-3 the translation between the two lived in the API's commissions `domain/`
(`plan-codec.ts`), which the paragraph above says must stay empty, and the builder would have needed a second, hand-kept
copy of it in the browser. A drifted copy would let the builder accept a plan the API refuses, on a money rule. So:

- The translator moves unchanged into the package (`src/plan-wire.ts`) and stays **internal**: neither entry exports it.
- The package gains one function, `validateWireCommissionPlan(plan)`, which translates and then calls
  `validateCommissionPlan`. Both entries export it with its input type `CommissionPlanWire`: the root for the API's
  use case, and `"./validation"` for `apps/admin/src/commissions`.
- `"./validation"` therefore exports `validateCommissionPlan`, `validateWireCommissionPlan`, the error codes, the plan
  types and `CommissionPlanWire`. It stays browser-safe with no import beyond `@pospay/domain`.
- The `"exports"` map, the three enforcement layers and every regex are unchanged. The package's `test:node` script also
  checks that both entries export the same `validateWireCommissionPlan` and that `"./validation"` does not export
  `computePeriod`.

**Enforcement, in three layers.** It is DECLARED by 59-0 and DELIVERED by 48a-1:

- **(a) The module-map check.** `docs/module-map.md` §6 gains `packages_restricted: commissions-engine: [commissions]`.
  `scripts/module-map/module-map.mjs` matches the module **name** (`from.module`), so one entry covers the API's and the
  worker's `commissions` modules. The check in `checkModules` fires only when `from.module !== null`, and `place()`
  returns `module: null` for everything that is not under `apps/<app>/src/modules/<module>/…` — so it cannot see
  `apps/admin`, `apps/api/src/shared`, `apps/worker/src/documents` or `packages/*`.
- **(b) ESLint `no-restricted-imports`.** Flat config **replaces** a rule's options with those of the last matching
  block instead of merging them, so one commissions override cannot work: placed last it drops the `use-cases/` and
  `domain/` bans for commissions files, placed first the `use-cases/` block replaces it and lets every module's use cases
  import the engine (Codex on #517). The rule is therefore composed per layer:
  - `boundaries.js` exports three `no-restricted-imports` pattern entries, written with the `regex` key the file already
    uses (`boundaries.js:115`), and **every** block that sets the rule includes all three (the base block, the `domain/`
    block, the `use-cases/` block and any later one):
    - `COMMISSIONS_ENGINE_ROOT_BAN` (`^@pospay/commissions-engine$`), lifted only by the backend exceptions below;
    - `COMMISSIONS_ENGINE_SUBPATH_BAN` (`^@pospay/commissions-engine/.+$`), lifted by **no** backend block; the admin
      block replaces it with one that allows exactly `@pospay/commissions-engine/validation`, so a future subpath in the
      `exports` map stays refused everywhere until an ADR names it;
    - `COMMISSIONS_ENGINE_PATH_BAN`, any relative specifier (`./` or `../`) with a `commissions-engine` path segment, which
      **no** block lifts. It matches `../../packages/commissions-engine/src/…` from an app and `../commissions-engine/src/…`
      from a sibling package alike, so no relative path can skip the `exports` map.
  - The exceptions are intersection blocks placed **after** those, each re-listing its own layer's patterns with the subpath and path bans but without
    `COMMISSIONS_ENGINE_ROOT_BAN`, only for the three allowed layers: `**/modules/commissions/use-cases/**` keeps the credential and
    infrastructure patterns of `use-cases/`; `**/modules/commissions/ports/**` and `**/modules/commissions/persistence/**`
    keep the base patterns. No other commissions layer gets an exception: `domain/`, `queries/`, `http/`, `events/` and
    `jobs/` keep the ban, and every module `domain/` imports only `@pospay/domain` (D-23). The admin exception lives in
    `apps/admin/eslint.config.js` with the app-relative glob `src/commissions/**` (each app lints from its own folder,
    `boundaries.js` lines 32–33): it keeps the base patterns, the root ban and the path ban, and of the package
    allows exactly `@pospay/commissions-engine/validation`.
  - 48a-1 adds negative lint tests: a non-commissions use case importing the engine fails; a commissions use case
    importing `@pospay/db` or `node:fs` still fails; a commissions use case importing the engine passes; a commissions
    `domain/`, `queries/` or `http/` file importing the engine fails; `apps/admin` importing the root fails and `/validation` passes (these two run from `apps/admin`).
  - `no-restricted-imports` sees static imports only, so the same ban also covers `import()` and `require()`, as
    `credentials.js` does for credential modules: `boundaries.js` exports `COMMISSIONS_ENGINE_SYNTAX`, the
    `no-restricted-syntax` selectors for an `ImportExpression` or a `require` call whose literal specifier matches
    any of the three. They join `restrictedSyntax()` in `packages/config/eslint/index.js`, the one builder every
    block uses for that rule (it is replaced the same way), and the same exception blocks set the rule from that builder
    without the root selector only; the subpath and path selectors stay in every backend block, and the admin block allows exactly
    `@pospay/commissions-engine/validation`. Because a later block replaces the whole rule, each exception
    block comes as a pair, one for source files and one for test files that calls `restrictedSyntax({ userText: true, … })`,
    so commissions tests keep the Arabic-text exemption. A non-literal specifier is already refused by `CREDENTIAL_SYNTAX`.
    48a-1 adds negative tests for `import()` and `require()` of the root and of a relative `packages/commissions-engine`
    path from a non-commissions file, from a commissions `domain/`, `queries/` and `http/` file, and from `apps/admin`, and
    of a relative path from a commissions use case, from `apps/admin/src/commissions` and from a sibling package under
    `packages/*`, and of any subpath, `/validation` included, statically and dynamically from a commissions use case, port and
    persistence file (all must fail),
    plus a passing lint test of a commissions use-case spec that holds Arabic text.
- **(c) The `"exports"` map** above: a deep path into the package is not resolvable at all.

48a-1 also extends the
`lint:docs` JSDoc rule (`packages/config/eslint/jsdoc.js`, `requireArabicJsdoc`, today scoped to `**/domain/**/*.ts`,
`**/ports/**/*.ts` and `packages/domain/src/**/*.ts`) to the package's `src/**`, so the moved functions keep the Arabic
JSDoc gate (CLAUDE.md §3.1).

**Correction to the spec.** D-17 says the restriction is "enforced by the boundaries lint". It is not: the *module*
restriction is enforced by the module-map check (layer a), and the *subpath exception* can only be a lint rule (layer b).
This ADR is that rule.

**Addendum (2026-11-22, 55-2f-0; CS-Q46 = PP-205.1, home confirmed by Waleed as PP-226): the second restricted package
`packages/commissions-posting`.** The period repair of 55-2f (FR-047) must run the correction step in the API, in one
transaction with the repair version, and the step lived only in `apps/worker`, which `apps/api` cannot import. The
engine cannot hold it: it is pure by this section and D-23, with no SQL and no `@pospay/db`. A copy would give two
pricing paths. CS-Q46 chose a shared home; this addendum fixes it.

- **What it holds.** The worker's correction step, moved without a logic change: the month recompute
  (`use-cases/commission-month-recompute.ts`), the posting orchestration (`use-cases/post-commission-corrections/`),
  the pure files it uses (`domain/commission-correction-*.ts`, `commission-source-ref.ts`,
  `commission-blocked-correction.ts`), its port, its Drizzle persistence and the four error classes it throws. The shape
  is the module shape of CLAUDE.md §2.2 (`domain/`, `ports/`, `persistence/`, `use-cases/`).
- **Its dependencies.** `@pospay/commissions-engine` (root entry), `@pospay/domain`, `@pospay/db`, `@pospay/ids` and `drizzle-orm`.
  `persistence/` uses the transaction type of `@pospay/db` and the Drizzle `sql` tag only; no raw client is exported
  (CLAUDE.md §5). The one signature change of the move: the block-notice writer is an optional input of the step. A
  caller that cannot record a block (the repair, which runs only while a block is open) omits it, and the step throws
  `CommissionBlockNoticesMissingError` immediately before it would insert a new block without one. The generation bump of
  that month may already have happened in the same transaction, so the caller's obligation is part of the contract: the
  whole scope the step receives is bound to one tenant transaction, and the error must leave that transaction's callback
  before any mapping to a response, so everything rolls back; a caller never catches it inside the transaction.
- **Who may import it.** `@pospay/commissions-posting` (root entry only; `"exports"` lists `"."` and nothing else) only
  from the `commissions` modules of `apps/api` and `apps/worker`: their `use-cases/`, `ports/` and `persistence/`, the
  layers that may import the engine, plus the module's wiring file (`commissions.module.ts`) and its module-level
  `__tests__/`, which bind and exercise the step's adapter and still may not import the engine. `docs/module-map.md` §6
  gains `packages_restricted: commissions-posting: [commissions]`. A commissions `domain/` still imports only
  `@pospay/domain`.
- **The engine's boundary.** The package may itself import the engine's root entry from its own `use-cases/`, `ports/`
  and `persistence/`, because it stands in for those layers of the commissions module. This is a narrow exception that
  names this one package: its `domain/` is as bound as any module's, a sibling package still may not import the engine,
  and the subpath and relative-path bans stay in force for it. The package's own ESLint config
  (`allowCommissionsEnginePackage`) lifts exactly that, adds an own-files rule (the engine, `@pospay/db`,
  `@pospay/domain`, `@pospay/ids`, `drizzle-orm` and its own files), and `packages/config/eslint/boundaries.js` carries the three
  `COMMISSIONS_POSTING_*` bans in every block next to the engine's. `scripts/module-map/commissions-posting.test.mjs`
  proves each of these, statically, dynamically and by relative path.
- **Not here.** The bell adapter (outbox, identity reader) stays in `apps/worker`. The engine stays pure. A third
  consumer of the step needs a new addendum.

### 2. The global table `operational_recovery_flags` (FR-053) — classification, shape, access

**Classification.** A global operational table: like the global identity tables of ADR-0003 §2, but **not identity**.
No `company_id`, no RLS, no tenant data and no personal data — a code, timestamps and an operator id. It is not a
tenant table and never enters the tenant-table inventory (`packages/db/test/tenant-table-inventory.ts`).

**Shape — an append-only ledger.** This replaces the spec's "code primary key" row, which would force the raiser to
hold `UPDATE` on a row it must not be able to clear:

| Column | Type | Note |
| --- | --- | --- |
| `id` | `uuid` | UUID v7 from the injected `IdGenerator`; no database default; `PRIMARY KEY (id)` |
| `code` | `text` | the incident code, e.g. `COMMISSION_REMINDER_SCHEDULES_LOST` |
| `raised_at` | `timestamptz` | when the flag was raised |
| `cleared_at` | `timestamptz` NULL | set only by the operator's confirmation |
| `cleared_by` | `uuid` NULL | the operator who confirmed it |

- A partial `UNIQUE (code) WHERE cleared_at IS NULL` — at most one open flag per code.
- `CHECK ((cleared_at IS NULL) = (cleared_by IS NULL))` — a flag is either open or cleared by somebody.
- Owned by the migration owner (`pospay_owner`), as every table is.

The first code is `COMMISSION_REMINDER_SCHEDULES_LOST` (FR-053).

**Access.** The worker uses the existing role `pospay_dispatcher` through the existing facade
`createOutboxDispatcherDatabase` in `packages/db/src/dispatcher.ts`, which gains two operations: **raise**
(`INSERT … ON CONFLICT DO NOTHING`) and **list the open flags**. Grants: `SELECT` and `INSERT` on this table only, to
`pospay_dispatcher`; no `UPDATE`, `DELETE` or `TRUNCATE` for any runtime role; `PUBLIC` nothing. This replaces the
`SELECT, INSERT, UPDATE` grant list that FR-053 first sketched: the runtime holds no `UPDATE`, because the runtime must
not be able to clear its own flag.

`pospay_app` is excluded on purpose: a writable table without RLS on `pospay_app` would be reachable from every tenant
query path, and would need a context-free entry point in `packages/db` — the "fifth way" CLAUDE.md §5 forbids.

The facade's `ping()` already feeds the worker's `/ready` (`apps/worker/src/main.ts`); `/ready` reports degraded while
any flag is open. The API never reads the table.

**Clearing.** Only an operator script run as the migration owner (the `platform:grant` precedent of ADR-0003 §3). It
names the **id of the incident** it confirms — never "the open flag of this code" — sets `cleared_at` and `cleared_by` in
one statement, and inserts a `platform_audit_log` row in the same transaction. A restart never clears: the runtime holds
no `UPDATE` and no `DELETE` on the table, so it cannot clear its own alarm. **Superseded by CS-Q32 (2026-10-23):** the
worker clears its own flag after a complete rebuild; see Consequences and spec 059 FR-053 (_CS-Q32_).

**What 56b-1 (the sub-PR that builds the table) must add.** The migration; the privilege allowlist entries for
`pospay_dispatcher` in `packages/db/test/table-grants.ts` (`operational_recovery_flags` `INSERT` and `SELECT`) and the
matching cases in `packages/db/src/__tests__/privileges.spec.ts`; a check that no other role holds any privilege on it;
the facade operations and their tests. Under CS-Q32 (Consequences) the new ADR before 56b-1 chooses the clearing role's narrow
clear (a column-level `UPDATE (cleared_at, cleared_by)` or a `SECURITY DEFINER` function), amends this section's access
rules, and adds the matching allowlist entry and privilege test for whichever it picks.

**Decided by the owners (CS-Q31, 2026-10-23, batch 51).** CLAUDE.md §5 says the dispatcher "reads and marks rows of the outbox
table only" (plus the one idempotency sweep). Giving it a second, tenant-free table is a change to that governing text
and to ADR-0003 (a new group 2.6, "global operational flags"). Waleed and Abu Salem both chose the recommended option: the
existing `pospay_dispatcher` role may `SELECT` and `INSERT` on `operational_recovery_flags` only (no `UPDATE`, no
`DELETE`), and the clear is a manual command run by the database owner. 59-0 still does **not** edit CLAUDE.md §5 or
ADR-0003: **56b-1 must amend both in its own PR**, together with the table and the grants, to name this grant. This
section stays Proposed until that PR. The refused alternative was a new narrow role `pospay_recovery` with its own
facade, at the cost of a connection pool, an env URL, a deploy secret, a facade entry in
`packages/config/eslint/index.js` (`FACADES`) and a role row in `packages/db/src/__tests__/privileges.spec.ts`.

### 3. One consumer id and the registrations (D-8, D-9)

`commissions.project-inputs` is the one consumer id of the six input event types (`ServiceSessionRecorded`,
`ServiceSessionLinesAdded`, `ServiceLineChanged`, `PackageSaleChanged`, `SessionTipsChanged`, `SalaryChanged`). Its
`consumed_events` mark commits in the same transaction as the projection change, the generation increment and the
corrections, under the statement locks; a stale-revision no-op still writes the mark.

A separate worker consumer of `CompanyCreated` only registers the reminder scheduler and is **not** counted by
ADR-0012. Changing the id needs an explicit dedupe transition (ADR-0012 §1).

### 4. Root-bound readers (D-15, D-16)

The bindings this slice needs, each one an interface **owned by commissions**, implemented by a
provider-owned reader and bound at the composition root, the way the root-bound `DaySessionsPort` is
(`docs/module-map.md` §3):

| What it reads | Provider |
| --- | --- |
| the business timezone and creation date for the two input writers (`BusinessCalendarPort`, 48-2 and 49-1) | `tenancy` |
| the in-transaction recheck of `manage:commission-plans:business` and the `commissions` feature, under `FOR SHARE` on the company and its memberships, including before replay (`CommissionPlanAccessPort`, 48-2 and 49-1, FR-010) | `identity` |
| the `FOR NO KEY UPDATE` lock on the employee row that orders version allocation and service-override writes (`EmployeeRowLockPort`, 48-2 and 49-1, FR-008/FR-012) | `staff` |
| service existence in the target business, read through readSessionServices on the writer's transaction without using its live rule to price history (`CommissionServiceReaderPort`, 49-1, FR-011) | `catalog` |
| unlocked permission/feature recheck through readCommissionPlanListAccess, active employee existence through employeeExistsInBusiness, and the business timezone through businessTimeZone (`CommissionServiceOverrideListReads`, 49-1, FR-013) | `identity`, `staff`, `tenancy` |
| unlocked permission/feature recheck through readCommissionPlanListAccess, the business timezone through businessTimeZone, and the plan screens' employee names and numbers through readCommissionPlanEmployeeNames (`CommissionPlanEmployeeListReads`, 48-2b, FR-010a; addendum 2026-11-02 below) | `identity`, `staff`, `tenancy` |
| service names | `catalog` |
| notification recipients | `identity` |
| the employee's business and dated branch attachments (FR-018b, FR-033) | `staff` |
| customer full names (D-20) | `customers` |
| tips and package sales for the bootstrap (ADR-0041 §6) | `orders` |
| the names of the branches where the work was done, read live by the open month's view and review (they enter the statement fingerprint) and again at approval, which freezes them in the statement lines (CS-Q35 settled: freeze; 56-1b-fz removed the export's live `CommissionBranchNamesReader`, #718; the first statement builder, 51-1, names the port and 53-2 reuses it) | `tenancy` |

Write-side interfaces live in `ports/`. The service-override list's read-only interface lives beside its query,
following the existing `EmployeeAppLinkNames` pattern, so queries do not import write ports. Its callback adapter
captures the caller's `Tx`; app.ts supplies provider-owned reads and commissions.module.ts checks the adapter's
shape against `CommissionServiceOverrideListReadsFactory`. PostgreSQL derives the business-local date from the
timezone within that same transaction. The list first rechecks the human actor's permission and feature through
the unlocked identity reader; the writer reuses the same decision only after its existing company/membership locks.
No employee query is copied into commissions, no provider join or read use
case is introduced, and the query imports no domain or engine. This is the manager-confirmed query-local design
of 49-1 ([plan](../specs/059-commissions-statements/plan-49-1.md), 2026-11-01).

**Addendum 2026-11-20 (49-2a, FR-013a).** The override screen's service list reuses the same
`CommissionServiceOverrideListReads` with one more root-bound provider: the catalog services page through
`readCommissionOverrideServices` (CS-Q49 name, catalog rule and price; CS-Q50 closed services stay listed and
editable). The provider set of the Port row grows by `catalog`; there is no import arrow, no read use case and no
migration — the page reads the existing `services` unique key and the existing override index.

**Lines and salaries are not a binding.** Spec 059 D-15 (decided 2026-10-25) replays the retained `ServiceSessionRecorded`,
`ServiceSessionLinesAdded`, `ServiceLineChanged` and `SalaryChanged` events from the outbox through a typed replay facade
in `packages/db` (read as `pospay_dispatcher`, effect and mark through `pospay_app` `withTenant`), so commissions needs
no orders reader to **build** them; how a legacy `SalaryChanged` without `business_id` is routed is decided below (PP-185). See the ADR-0012 addendum of 2026-10-25.

**Addendum 2026-11-12 (PP-185, spec 059 owner-questions §§47–50).** The replay still builds lines and salaries. Two root-bound
readers are added **for the coverage proof only**, never to build a projection: an orders-owned reader returning each
retained service line's identity and latest revision, and a staff-owned reader returning (employee, effective date,
revision) from the salary history. Approval stays closed until the projection revision is ≥ the source revision for every
line and salary row. A legacy `SalaryChanged` without `business_id` is delivered by the replay to the same consumer, which
resolves the business through the root-bound staff reader `readEmployeeBusiness` on its own transaction; a null result
leaves the event unmarked and approval closed. Both coverage readers are root-bound reads under the rule above (Port rows,
no import arrow); sub-PR 50-3c adds them with their `docs/module-map.md` Port rows.

A root-bound read adds a **Port row** to `docs/module-map.md` §3 and **no import arrow** and **no `reads:` line** (a
`reads` line is for an import arrow and must name its adapter file, so it is added only by a sub-PR that really needs an
import). 59-0 added the Port rows for its own root-bound readers to `docs/module-map.md` §3 in the same PR; the two
coverage readers of the 2026-11-12 addendum get theirs in sub-PR 50-3c, the PR that adds the readers.

**Amendment 2026-11-13 (sub-PR 50-3c).** The two coverage readers are the ports `ServiceLineCoverageReader` (the
orders-owned `readServiceLineCoveragePage`) and `SalaryCoverageReader` (the staff-owned `readSalaryCoveragePage`); both are
owned by `commissions` and bound at the worker composition root `apps/worker/src/report-commission-coverage.ts`. The comparison
is the pure `compareCoverage` in `packages/commissions-engine`: a projection revision >= the source revision is covered, a key
with no projection row is missing, and a lower revision is stale; the comparison stays in the worker's report, and 53-2's approval does not recompute it with api-side readers: it reads a stored bootstrap coverage proof (addendum 2026-11-22, CS-Q54). The
Port rows are added to `docs/module-map.md` §3; there is no import arrow, no migration, no new role and no new grant. The
retained-event check (the events without the consumer's mark) reads the outbox only through `commissionInputReplayPage` as
`pospay_dispatcher` and reads the consumer's marks through `pospay_app` `withTenant`. The third coverage reader port is
`CoverageCompanyReader`: owned by `commissions`, bound at the worker composition root to the tenancy `companyOpen`; it decides
whether the company exists and is not deleted, so the report refuses a scope it cannot report on instead of covering an empty range.

**Amendment 2026-11-13 (sub-PR 50-3d).** The retained-event check moves to the six-type facade `commissionRetainedEventPage`
(`ServiceSessionRecorded`, `ServiceSessionLinesAdded`, `ServiceLineChanged`, `SalaryChanged`, `SessionTipsChanged` and
`PackageSaleChanged`) with its own partial index `outbox_commission_retained_replay_idx`, so the check covers the tip events too:
every retained `SessionTipsChanged` event id must carry the consumer's mark. The tip coverage by revision is added to the same
report through the existing root-bound `CurrentTipSessionsReader` (the orders-owned `readCurrentSessionTips`), bound at the worker
composition root, over the business ids and the business-day range the operator supplies; without that scope the report prints
`tips: null` and a `tipsNote` that says the tip coverage was NOT checked. The same report gains a `notHandled` block: a retained
event whose type the consumer does not handle is listed with the fixed reason `COMMISSION_EVENT_TYPE_NOT_HANDLED` instead of as an
ordinary missing mark. **Consequence:** a tenant with any retained `PackageSaleChanged` event stays `NOT_COVERED` until 50-4
registers that handler, and the 55-1b R5 prerequisite ("coverage shows no gap before the first correction posts") is blocked for
that tenant until then. There is no new port, no import arrow, no new role and no new grant: `tipRevisions` is projection-side, the
tips reader reuses an existing port, and the third coverage reader port remains `CoverageCompanyReader` (owned by `commissions`,
bound at the worker composition root to the tenancy `companyOpen`).

**Amendment 2026-11-22 (issue #1032, the coverage report cannot print a false `COVERED`).** The report keeps every check it has
(missing and stale revisions, retained counted events without the consumer's mark, unhandled types) and adds to them. The overall
status is `COVERED` only when lines, salaries, sales and tips were all checked and no check failed; a run with no tip scope reports the
tips as not checked (`tips: null` and its `tipsNote`), is `NOT_COVERED` and exits non-zero. There is no default to all businesses. The
use case refuses, before any scan, a company that does not exist, an empty business list, a business id that is not a UUID, a range whose `from` is after its `to`, and a
business that is not the company's, with the existing `COMMISSION_COVERAGE_SCOPE_INVALID`; the command line refuses the malformed forms
earlier, while parsing its arguments, with `COMMISSION_COVERAGE_CONFIGURATION`, so it prints `SCOPE_INVALID` only for a company that does not exist, a business
that is not the company's (both before any scan) and a bad `--through`, which is refused later, after the scan, because it compares the last event read
with the bound. The retained-event mark check ends at the printed `throughId` and looks at nothing after it. Without `--through` that bound is not taken when
the command starts: lines, salaries and sales are scanned first, then the bound is the highest id among all of the company's retained events of the six counted
types, read once before the first retained-event page is fetched (not the maximum of the first page), so `throughId` is not a start-up cutoff. The replay's cutoff and the proof's cutoff are different things: the 50-3a replay bound is chosen over
four event types and this report's over six, so the two values can legitimately differ and are not required to match. The evidence used to open
approval is one run with no `--through`, taken in the quiet window and naming every business; its printed `throughId` is the bound it proved up to
and is recorded with the proof; `throughId` values are compared as UUIDs ignoring letter case. If it reports unmarked retained events the remedy is the six-type
retained replay (50-3d) and a new run; a `notHandled` event (`COMMISSION_EVENT_TYPE_NOT_HANDLED`) keeps approval closed and is not fixed by a replay, which
delivers only the types the consumer registers: the worker release or handler registration is corrected first, then the replay, then a new run. A run
that cannot prove the whole scope leaves approval closed. The fourth coverage reader port is `CoverageBusinessReader`:
owned by `commissions`, bound at the worker composition root to the existing tenancy `businessTimeZone` on the report's tenant
transaction (`pospay_app` under `withTenant`); its Port row is in `docs/module-map.md`. The printed result names the business ids and
the date range the tip check covered (`tipScope`): `COVERED` proves that scope only, and opening approval for a company needs a run
whose scope is every business of the company and every business day with inputs, which the runbook requires of the operator and the
tool does not infer. No import arrow, no migration, no new role and no new grant.

**The rule from D-16:** if a reader cannot be bound at the root, the sub-PR that needs it stops and adds an ADR and the
module-map row first.

**Addendum (2026-11-02, 48-2b): the plan screens' employee list (FR-010a).**

- **What it serves.** `GET /v1/businesses/{businessId}/commission-plan-employees` lets a holder of
  `manage:commission-plans:business` without `manage:employees:business` pick employees in the plan builder. The
  staff employee routes stay closed to that holder.
- **The port.** `CommissionPlanEmployeeListReads` is a read-only interface owned by commissions. It lives beside its query
  in `queries/commission-plan-employees.query.ts`, as the 49-1 list's interface does, and has three methods, each with
  its adapter:
  - `access` → `readCommissionPlanListAccess` (`identity`, `persistence/commission-plan-access.ts`)
  - `timeZone` → `businessTimeZone` (`tenancy`, `queries/business-time-zone.query.ts`)
  - `employeeNames` → `readCommissionPlanEmployeeNames` (`staff`, `persistence/commission-plan-employee-names.ts`,
    exported from the staff `index.ts`)

  The staff reader owns the limited SQL. It reads only `id`, `name_ar`, `name_en`, `employee_number` and the stored
  `name_en_key` of the business's employees with `deleted_at IS NULL`, in `(name_en_key, id)` order. `name_en_key` goes
  into the next cursor only; the response item keeps the four other fields. No employee query is copied into
  commissions.
- **The root binding.** `app.ts` (`commissionBindings`) passes the three tx-first functions as
  `CommissionPlanEmployeeListReads`, the port itself (one interface; no second tx-less copy and no adapter between
  them). `commissions.module.ts` binds the token `COMMISSION_PLAN_EMPLOYEE_LIST` to
  `createCommissionPlanEmployeeList(database, reads)`, and the controller injects only that runner.
- **How it differs from 49-1.** In 49-1 the controller opens `withTenant` and passes `Tx` into the query. Here the runner
  in `queries/` opens the single `withTenant(companyId, …, { userId })` itself. It reads in this order: access, then the
  business timezone (`null` → `FORBIDDEN`), then the cursor (invalid → `VALIDATION_FAILED`), then the names. All four run
  sequentially on that one transaction, with no nested or concurrent transaction.
- **§4.1 is unchanged.** Because the controller takes the runner, it imports no `TenantWrappers`, and the cursor validates
  with `id` from `@pospay/contracts` instead of `zod`. The new files therefore need no entry in the §4.1 list. The query
  file's type-only imports of `TenantWrappers` and `Tx` from `@pospay/db` are the `queries/` row of the import matrix,
  not a scoped addition.
- **The cursor carries the sort position by value (round 4, 2026-11-03).** It holds `{v, c, b, k, i}` as canonical
  base64url: the company, the business, the last row's `name_en_key` exactly as SQL returned it, and that row's id
  (ids lower-cased). The next page reads `(e.name_en_key, e.id) > (k, i)` and never looks the anchor row up.
  - **Why.** The cursor is unsigned. The first release anchored on the id alone and re-read the anchor's key with no
    `deleted_at` filter, so a forged cursor with a soft-deleted employee's id returned the rows after it while a missing
    id returned an empty page: the difference revealed that the id had been an employee of the business (review threads
    r4445819849 and r4445819864 on PR #793). With the position carried by value, a deleted id and a missing id with the
    same `k` give the same page, and a soft-deleted anchor still does not end the list.
  - **Integrity without a secret.** Decoding refuses a cursor longer than the cap before it is decoded, a non-canonical
    encoding, a version other than 1, ids that fail `id` or belong to another company or business, a `k` that is not a
    string or contains NUL (PostgreSQL text cannot hold it), and any cursor whose re-encoding differs from the input,
    which covers extra, missing, duplicated and reordered keys and upper-case ids. `c` and `b` stay for parity with 49-1;
    they are not a security control, because the path, the guard and RLS decide the scope. There is no HMAC, no secret
    and no migration.
  - **The cap.** `k` is not truncated, so the cap follows the longest key a 255-unit name can produce. A scan of every
    Unicode code point found U+FDFA the largest single-point expansion under the key function (18 units, 33 UTF-8 bytes
    per input unit, the same in JS and in the legacy SQL key). U+FDFA ×255 gives a key of 4590 units / 8415 bytes and a
    cursor of 11411 characters; ASCII ×255 gives 531, Arabic ×255 871. The cap is
    `COMMISSION_PLAN_EMPLOYEE_CURSOR_MAX = 12288`, on the query parameter and on `next_cursor`.
  - **The request budget.** Node's default `maxHeaderSize` (16 KiB) covers the request line and all headers, and the
    parent-domain session cookies share it. The API therefore sets `API_MAX_HEADER_BYTES = 32768` through the Fastify
    adapter's `http.maxHeaderSize`. Past it Fastify writes a raw `431` on the socket before Nest runs, so that response
    is not our error envelope and carries no CORS headers. The staging proxy (Traefik v3.6.7) has no smaller header
    limit; production proxy limits were not verified.
  - **Decision record.** SA approved, recorded as 21:24 (replacing 21:14), through the manager thread, verbatim: "set the
    API's maxHeaderSize explicitly to 32 KiB, cap the cursor at 12288 and check it before decoding, and add a real HTTP
    test of the limit. No Traefik change, no secret. The original size cap stays in the record. Round 4/5 may continue."
  - **History (the original cap).** The first release capped the cursor at 512 characters and kept `name_en_key` out of
    it, both because the key is unbounded and to keep a normalised name out of URLs and logs. Round 4 accepts the key in
    the cursor to close the disclosure above; the URL now carries the normalised name of the last row on the page.
  - **Trade-off kept.** Renaming an employee between two page requests can still skip or repeat that row in one walk;
    this stays tracked in [issue #796](https://github.com/lolotam/PayPos.systems/issues/796).
- **Addendum 2026-11-05 (PP-122; spec 059 owner-questions §44, owner-decisions §60): fix both before merge.**
  - **Stored key longer than the cap.** The cap bounds what a 255-unit name produces today. A legacy stored key can be
    longer, so the query checks `next_cursor.length` after encoding and before `commissionPlanEmployeeList.parse`. Past
    12288 it throws `COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE` (503), not a `ZodError` that ends as a generic 500.
    The controller logs it once, with only `{ code }` and the constant event
    `commission plan employee cursor unavailable`. It is 503, not 400, because the client sent nothing wrong; the row
    needs repair. A last page encodes no cursor and is not refused.
  - **Tie-breaker index.** The old `(company_id, business_id, name_en_key)` index has no `id`, so CI showed an
    Incremental Sort and filtered rescans of a repeated name. A new partial index
    `employees_company_business_name_en_key_id_active_idx (company_id, business_id, name_en_key, id) WHERE deleted_at IS NULL`
    is built `CONCURRENTLY` in its own migration (ADR-0033). The old indexes stay (expand only). The migration runner's
    recovery keeps a valid identical index, rejects a different definition and rebuilds an invalid one.
  - **Legacy keys are re-derived before the build (manager, round 2, 2026-11-05 02:22 Kuwait).** The new index adds
    `id`, 16 bytes per entry. On PostgreSQL 16 the old index accepts an incompressible key of up to 2660 bytes and the
    new one only up to 2644. A stored key in that window would make the build fail with `54000`. So 0204 carries
    `-- pospay:data-step employee-name-keys`. The runner runs that registered step before the `CONCURRENTLY` prefix of
    the same migration (`applyOne` in `concurrent-migrations.ts`). The step is `rekeyEmployeeNameKeys`, the one 0101/0102
    use. It reads only `companies.id` as the migration owner. For each company, under `withTenant`, it rewrites every
    `name_en_key` that differs from `employeeNameMatchKey(name_en)`. Rerunning it writes no row. A key that was not
    derived from its name is therefore repaired, and the build succeeds. `employee-name-key-id-index.spec.ts` covers
    both the repair and the rerun.
  - **Remaining risk, theoretical.** The step cannot shorten a key that is already derived correctly. Capping
    `employeeNameMatchKey` would change the name-matching rule, so it was not done. No canonical key is known to reach
    the window:
    - The contract caps `name_en` at 255 UTF-16 units.
    - The `employees_name_en_length` CHECK, present since 0038, caps it at 255 code points.
    - Under that CHECK, 255 distinct characters with the largest NFKC expansion give a 2093-byte key; under the contract
      cap they give 2003 bytes.
    - A longer key needs repeated characters, which the index-tuple compression shrinks. On the lane (`pglz`, the
      default), 16 adversarial 255-code-point names with keys of 2093 to 8415 raw bytes all entered the new index.

    This is evidence, not a proof. If such a key ever exists, the build fails with `54000`, leaving an invalid index and
    no journal row. A rerun after the row is repaired rebuilds the index (ADR-0033;
    `concurrent-index-recovery.spec.ts`).

The addendum adds one Port row to `docs/module-map.md` §3. It adds no import arrow, no `reads:` line, no write port
and no grant. PP-122 adds one index migration, which first runs the existing `employee-name-keys` data step.

**Addendum 2026-11-21 (50-4; owner answer CS-Q51, [spec 059 owner-questions §60](../specs/059-commissions-statements/owner-questions.ar.md)):
the package-sale coverage reader and the replay as the sale bootstrap.**

- **Reader.** Worker `commissions` gains the coverage reader `PackageSaleCoverageReader`, bound at the worker
  composition root `apps/worker/src/report-commission-coverage.ts` to orders' `listCurrentPackageSales`
  (`apps/worker/src/modules/orders/queries/package-sale-coverage.reader.ts`), on exactly the terms of
  `ServiceLineCoverageReader` (the 2026-11-12 addendum): a read-only keyset page on `package_entitlements`' primary key,
  `provenance = 'SOLD'` only (imports emit no event and stay outside sale coverage, D-51), identity and revision only —
  no customer, phone, name or money column. It opens no transaction and takes no lock. Coverage proof only, never a
  projection build; no import arrow and no `reads:` line (one Port row in `docs/module-map.md` §3).
- **Bootstrap.** The owner answered CS-Q51 verbatim: «دخل المبيعات القديمة بالمسار الموجود، واستعمل القارئ للتأكد إن
  كل بيع وصل بآخر نسخة». The existing six-type retained-event replay of 50-3d is the sale bootstrap: registering
  `PackageSaleChanged` in `COMMISSION_INPUT_EVENT_TYPES` is the whole producer-side change, the replay delivers and
  marks the retained events with no runner change, and the reader is the fail-closed coverage truth by revision.
  No second bootstrap writer, no event-id column on any orders table, no outbox grant — D-15's prohibitions stand, and
  the spec 059 D-15, FR-020 and CM-20b rows carry the dated amendment notes.
- **Table.** `commission_sales` (migrations 0234/0235, expand-only) is a tenant table under `withTenant`, with
  `FORCE` RLS, tenant-qualified composite foreign keys, column-limited `UPDATE` and no `DELETE`, like the tip and
  salary tables of the 2026-11-05 entry. CM-R05 ships in the same PR.

### 4.1 Scoped layer imports for 48-2/49-1 (PP-108.1)

**Accepted by Waleed, 2026-11-01, channel «كارت في شات مدير الويب».** The verbatim decision is preserved in
[spec 059's owner record §42](../specs/059-commissions-statements/owner-questions.ar.md) and indexed as PP-108.1 in
[the owner-decision index](../owner-decisions.ar.md). [Issue #763](https://github.com/lolotam/PayPos.systems/issues/763)
tracks this documentation follow-up after #762. The decision keeps the existing code and records exactly the
following uses for the plan-version and service-override input writers and lists (48-2/49-1) in the API's
`commissions` module. These are the scoped additions to
[CLAUDE.architecture.md §3.1](../../CLAUDE.architecture.md#31-the-import-matrix--enforced-by-eslint-not-by-memory),
not a general package allowance for other modules or other commissions paths.

**Exhaustive file-and-import scope.** Every path below is relative to `apps/api/src/modules/commissions/`.
Each row permits only its named import in its named file. There are no directory globs, implicit sibling files
or future-file allowances; this list defines the scoped paths in CLAUDE.architecture.md §3.1.

| File | Additional permitted import |
| --- | --- |
| `ports/commission-plan-version-transactions.port.ts` | `CommissionPlanVersion`, `CreateCommissionPlanVersionInput` from `@pospay/contracts`, type-only |
| `ports/commission-service-override-transactions.port.ts` | `CommissionServiceOverride`, `CreateCommissionServiceOverrideInput` from `@pospay/contracts`, type-only |
| `ports/business-calendar.port.ts` | `Tx` from `@pospay/db`, type-only |
| `ports/commission-plan-access.port.ts` | `Tx` from `@pospay/db`, type-only |
| `ports/employee-row-lock.port.ts` | `Tx` from `@pospay/db`, type-only |
| `ports/commission-service-reader.port.ts` | `Tx` from `@pospay/db`, type-only |
| `use-cases/lock-through-decision.ts` | `localDate` from `@pospay/i18n` |
| `use-cases/create-commission-plan-version/create-commission-plan-version.usecase.ts` | `localDate` from `@pospay/i18n` |
| `use-cases/create-commission-service-override/create-commission-service-override.usecase.ts` | `localDate` from `@pospay/i18n` |
| `queries/commission-service-override-cursor.ts` | `z` from `zod`, for input/cursor validation |
| `persistence/commission-plan-version-writer.ts` | `commissionPlanVersion` and its `CommissionPlanVersion` type from `@pospay/contracts`, for response-contract validation |
| `persistence/commission-service-override-writer.ts` | `commissionServiceOverride` and its `CommissionServiceOverride` type from `@pospay/contracts`, for response-contract validation |
| `http/commission-plan-versions.controller.ts` | `TenantWrappers` from `@pospay/db`, type-only |
| `http/commission-service-overrides.controller.ts` | `TenantWrappers` from `@pospay/db`, type-only |

The DTOs describe writer commands and stored responses; `Tx` types the readers' existing transaction, without
runtime database access in ports. `localDate` is pure and converts supplied instants using the injected `Clock`
and business calendar, with no direct clock access or I/O. Query validation stays read-only and imports neither
domain nor use cases. Response-contract checking remains in persistence and adds no business calculation.
The HTTP wrapper is injected: each list route opens its existing `withTenant` read transaction, without direct
SQL; the service-override list passes that same `Tx` to its query and root-bound readers.

**Enforcement limit:** current lint rules do **not** CI-enforce this exhaustive file-and-import list. Code review
must check its scope; a passing lint run does not permit another file or import to claim the allowance. This
documentation follow-up leaves existing lint gates unchanged and makes no claim of new automatic enforcement.

This addendum does not change code, lint configuration, migrations or the module map. It adds no dependency to
`domain/`, no SQL or I/O to use cases, no runtime database access to ports and no cross-module import arrow.
The root-bound readers and transaction ownership in §4 remain unchanged; the five uses above are the complete
scope of PP-108.1.

### 5. The read use cases (D-7) — the one read-path exception

CLAUDE.architecture.md §7 and CLAUDE.md §6 say reads go through `queries/`, which may not import `domain/`. The estimate
and the statement view must run the engine, so they are use cases. **Exactly two folders** are the exception:
`use-cases/get-commission-estimate/` and `use-cases/get-statement/` of the `commissions` module. A third name needs an
addendum to this ADR. Plain lists (plan versions, overrides, corrections, blocked corrections) stay in `queries/` with
`EXPLAIN` tests.

The rules of the exception:

- A read use case depends on **reader ports only** — a port with no write method; never a repository, an outbox writer
  or an `IdGenerator`.
- It creates no statement row, takes no lock, writes no audit row and no outbox row.
- The transaction its adapter opens is **READ ONLY**: a `{ readOnly: true }` option of `withTenant`, added by 50-5.
  `packages/db/src/with-tenant.ts` has no such option today (`TenantOptions` carries `userId`, `timeoutMs`,
  `drainOnTimeout`).

The `use-cases/` lint rule (no `@pospay/db`, no `drizzle`) is necessary but not enough, because a port can still write.
So the gates are: a unit test of each use case's **constructor surface** (only reader ports) and the after-call
database assertion of CM-28b ("`GET` of a month that was never generated returns the computed view with
`generated: false` and leaves no statement row, no fingerprint and no lock behind").

CLAUDE.md §6 and CLAUDE.architecture.md §7 get a one-line pointer to this section in the same PR.

**Addendum (2026-10-29, sub-PR 56-1b): a third read use case.** `apps/worker/src/modules/commissions/use-cases/read-commission-statement-export/`
is the third name. It is the worker's document source for the statement export (FR-050, CM-55), not an HTTP read endpoint,
and it computes the per-employee totals through `domain/commission-statement-totals.ts`, so it cannot live in `queries/`.
It follows every rule above: it depends on reader ports only (the export reader; 56-1b also bound `CommissionBranchNamesReader`, which 56-1b-fz removed when CS-Q35 froze the branch name in the rows), it
runs SELECT statements only in one `withTenant` transaction, and it writes no row, audit or outbox entry. It adopts the
`{ readOnly: true }` option when 50-5 adds it, like the other two.

### 6. The two fingerprints (D-5, D-6)

**Where the builders live.** Both are pure functions in `packages/commissions-engine`: a commissions `domain/` folder
cannot import the package (section 1), and the statement builder consumes engine output.

**How they hash.** The hash is an **injected port** in the commissions `ports/` folder: `hash(value)` takes the
structured JSON value and returns lowercase hex SHA-256. One `persistence/` adapter implements it with `canonicalJson`
from `@pospay/db` (`packages/db/src/canonical-json.ts`) and `node:crypto`; `use-cases/` may not import `@pospay/db`.
The builders therefore emit KWD strings and ISO dates only, because `canonicalJson` rejects `bigint` and non-plain
objects.

**What the input fingerprint covers.** Exactly "what a writer's change moves" (D-6): the period's ordered inputs. The
**branch attribution** (the employee's dated branch attachments) is in the **statement** fingerprint only, because a
staff attachment change is not a commissions input and takes no statement lock (D-5, CM-32b, CM-34e). The spec's §6
_Fingerprint_ text that put the branch attribution in the input fingerprint is corrected by this PR.

**One build per approval transaction.** Approval calls the statement builder **once** and feeds both the pre-freeze
comparison and the freeze insert from that one result, so names and attachments read under READ COMMITTED cannot differ
between the compared rows and the frozen rows.

**What each comparison uses.** Before the freeze, approval compares the **input** fingerprint with `reviewed_fingerprint`
and the **statement** fingerprint of the rows the builder gives now with `reviewed_statement_fingerprint` (the early
refusal, FR-032). After the freeze, approval reads the frozen rows back, builds the same canonical shape and compares
**statement** fingerprints only — the frozen rows hold no revisions, rule snapshots, salary or plans, so they cannot
reproduce the input fingerprint. When both differ, the 409 cause is `INPUTS`.

**What 51-1 must fix.** The complete canonical contract: the fields of every list, the treatment of `null`, the tie
order, the date formats, and every input the engine reads (such as a sale's `business_date` and `status`) — and prove
it with the round-trip test CM-34e.

## Alternatives considered

- **Keep the engine inside the commissions module's `domain/` and import it from the worker through `apps/api`.** The
  worker and the API would share code across apps; the worker's image would depend on the API's source.
- **Copy the engine into the worker.** Two copies of the money rules, and they would drift.
- **A new database role `pospay_recovery` now.** More infrastructure (a pool, a URL, a secret, a facade entry) for a
  table with no tenant data — kept as the fallback of section 2.
- **Grant the table to `pospay_app`.** A writable table without RLS on `pospay_app` is reachable from every tenant query
  path and needs a context-free entry point — the fifth way CLAUDE.md §5 forbids.
- **A `code` primary key with a mutable `cleared_at`.** The runtime could clear its own alarm; the append-only ledger
  keeps the raiser and the clearer apart.
- **One fingerprint for both purposes.** The frozen rows cannot reproduce the inputs, so every real approval would be
  refused.
- **Hashing inside `domain/`.** `domain/` imports nothing; the hash is a port.
- **Reads of the estimate in `queries/`.** `queries/` may not import `domain/`, so the engine could not run.

## Consequences

- 48a-1 carries the enforcement work: the three layers of section 1, the lint test, and the JSDoc scope for the moved
  functions.
- 50-5 adds the `{ readOnly: true }` option to `withTenant`; the read use cases depend on it.
- 56b-1 is **no longer blocked by CS-Q31** (decided, 2026-10-23): the table's grants change the governing text of
  CLAUDE.md §5 and ADR-0003, so 56b-1 amends both in its own PR to name the `pospay_dispatcher` grant. By **CS-Q32**
  (batch 53; decided 2026-10-23 by Waleed and Abu Salem) the worker rebuilds every company's schedule by itself after a Redis
  loss, through a narrow read of company ids only (a new mechanism: ADR-0038 covers only the migrate step), and clears its own
  flag only after every company's rebuild succeeds. That supersedes section 2's manual-only clearing and the
  `SELECT`/`INSERT`-only grant, and turns the operator replay into a fallback. 56b-1 therefore starts with a new ADR
  that defines the clear privilege, the incident-and-generation guard, the bounded retry and the audit path (spec 059
  FR-053, _CS-Q32_).
- Every sub-PR that adds a root binding adds its Port row to `docs/module-map.md` §3, or stops and writes an ADR first
  (D-16).
- The spec is corrected in the same PR: D-17 (the enforcement of the restriction), FR-053 (the table's shape and
  grants), §6 _Fingerprint_ (the place of the branch attribution) and D-18 (the claim that a bytes kind is built while
  Chromium is down, which holds only after 56-0 decouples the queue from the renderer — see the ADR-0049 addendum).

### Addendum 2026-11-24 (53-2 B1): issuance CLI port bindings

`apps/worker/src/issue-commission-coverage.ts` binds a commissions-owned `CoverageTipExistenceReader` to
Orders' `readSessionTipsAfterBound`, a read-only existence query with `business_date > U` and no upper bound.
It uses the existing app privileges inside `withTenant`, rejects an unknown business and returns only a boolean.
The same root binds `CoverageIssuanceDependencies.businessIds` to tenancy's `coverageBusinessIds` to reject a partial
company scope even in dry-run. These are port bindings, not module import arrows; no grant or migration is added.
The generation and UTC bound are sampled together in one dispatcher SELECT using the existing 0250 generation function.
The issuing facade keeps that transaction open through verification so refusals and dry-runs roll back the ensure row too.
Each successful re-run performs a new report and issues a new proof on the next generation; it never revives an old proof.
The switch audit follows #1223 item 12: `--operator-email` only, resolved `user.id` in `set_by`,
`actor = user:<id>`, `details = {company_id, reason, operator_user_id}`, `target_user_id = NULL`, no email in the log.

## Open questions for the owner

- **CS-Q32** (batch 53, PP-37.1): decided on 2026-10-23 by Waleed and Abu Salem, fully automatic (rebuild and clear by the
  worker). A new ADR records the narrow company-id read and the self-clear before 56b-1.
- **CS-Q31** (may the dispatcher role also hold `SELECT` and `INSERT` on the tenant-free
  `operational_recovery_flags` table, or does the owner want a new narrow role `pospay_recovery`?) was decided on
  2026-10-23: the dispatcher role, as recommended (Waleed and Abu Salem).
  Link: [../specs/059-commissions-statements/owner-questions.ar.md](../specs/059-commissions-statements/owner-questions.ar.md)

## Addendum 2026-11-22 (decision T3 = CS-Q54, row 53-2): the bootstrap coverage proof — **Accepted** (CS-Q55 and CS-Q55-ب, 2026-11-23)

**Status: Accepted — owner (Waleed) accepted on 2026-11-23 (CS-Q55, `docs/specs/059-commissions-statements/owner-questions.ar.md` §64, in the chat, relayed by the PosPay manager): 1. «حساب الخدمة الحالي (المقترح)», 2. «اقبل حدود الثقة دي (المقترح)», 3. «اقبل الإجراءات الموثقة للحالات دي (المقترح)», 4. «اقبل الإجراءات في الحالات الثلاث (المقترح)»; and the tip-record point, CS-Q55-ب: «تحقّق فعلي من السجلات وارفض الإصدار لو فيه بقشيش قديم بعد الحد (المقترح)».** Written by the 53-2 implementer lane and revised after review rounds 1 to 3 of PR #1219. The acceptance covers the design **as chosen in section 12 and nothing wider**. It opens approval for no company (section 9), and it writes no gate or grant code: 53-2 code starts from follow-up #1223. No migration number is taken here: the migration of the objects below takes a turn in the 53-2 slot of the queue, after 52-1.

**Decision (owner, CS-Q54, 2026-11-22, verbatim):** «إثبات تأسيسي مخزّن (المقترح)، بشرط تقييد إصداره وإبطاله عند تغيّر
شروط التغطية». Record: [owner-questions.ar.md §63](../specs/059-commissions-statements/owner-questions.ar.md) and
[research.md R11](../specs/059-commissions-statements/51-56-statements-delivery/research.md). R11 also records that the
mechanism may only close; who may issue (section 3) and the other three choices of section 12 were settled by CS-Q55 on 2026-11-23.

**What changes in this ADR.** Section 4's sentence «53-2's api binding reuses `compareCoverage` later with api-side
readers» is superseded. The comparison stays in the worker's coverage report (the issuer's run, 50-3c and the #1032
rules). The approval transaction does **not** recompute it: it reads the stored proof, then runs the ADR-0012 count
(section 7). Measured reason (research R11): the live comparison cost 76 ms for 1 000 lines and 2 083 ms for 20 000;
salaries 3 688 ms for 3 000 rows of one employee; package sales 2 833 ms for 5 000; tips were not measured.

**What the proof is for.** After the bootstrap, inputs arrive as counted events through the registered writers, and the ADR-0012 count already keeps approval closed while one has no consumer mark. What the count cannot see is a source row **whose event never existed**. The proof closes that gap once per company; it is a «bootstrap verified» fact, not a per-approval check. **It holds only while no writer outside the runner writes source rows silently and while the operator procedures of section 12, items 3 and 4 are followed**; the database does not enforce those, and the text below says so where it matters.

### 1. The objects (two tables, one version function, four functions)

| Object | Definition |
| --- | --- |
| `COMMISSION_COVERAGE_PROOF_VERSION` and `commission_coverage_required_version()` | An integer constant in `packages/domain`, starting at 1, read by the issuer and the approval check; and a `STABLE` SQL function returning the same literal, **replaced by `CREATE OR REPLACE` in the migration of every release that changes the coverage conditions**. The database, not the binary, is what refuses an out-of-date version (section 5). A test asserts the constant equals the installed function's value after all migrations, so a bump without a migration fails. |
| `commission_coverage_state` | Tenant table: PK `(company_id, id)` **plus `UNIQUE (company_id)`** (CLAUDE.md §5, ADR-0007), **`ENABLE` and `FORCE ROW LEVEL SECURITY`**. `generation bigint NOT NULL`, `bumped_at`, `reason`. It is the one lock target and the one invalidation switch. `BEFORE DELETE` and `BEFORE TRUNCATE` triggers refuse, so a generation cannot be reset by deleting the row. |
| `commission_coverage_proofs` | Tenant table, **insert-only**, PK `(company_id, id)`, **`ENABLE` and `FORCE ROW LEVEL SECURITY`**, **`UNIQUE (company_id, generation)`**. Columns: `generation` (the state generation **assigned by the issue function after it holds the state-row lock**; this is the database-generated issuance ordinal), `version`, `business_ids uuid[]` (every business of the company at issue time, sorted, non-empty), `tip_from`, `tip_to`, `tip_day_bound date` (section 6), `counted_types text[]`, `consumer_id`, `report_through_id` (the bound the report printed), `verified_through_id` (the function's own maximum), `database_name`, `system_id bigint`, `issued_at` (audit only), `run_id`, `release` (labels, at most 100 characters), `issued_by` (`session_user`). `BEFORE UPDATE OR DELETE` row triggers and a `BEFORE TRUNCATE` trigger refuse. |
| Functions (all `SECURITY DEFINER`; **all `VOLATILE`, the gate included**: its only write is the ensure insert at generation 0 (section 7, step 5), and `SELECT … FOR SHARE` is refused in a non-volatile function and its later statement needs a fresh snapshot; `search_path = pg_catalog, pg_temp`, `row_security = on`, fixed schema-qualified SQL, no dynamic execution, owned by `pospay_coverage_issuer`) | `issue_commission_coverage_proof(...)` and `current_commission_coverage_generation(company, state_id)` (dispatcher only; it ensures the state row, then reads its generation); `read_commission_coverage_gate(state_id)` and `invalidate_commission_coverage(state_id, reason)` (`pospay_app` only; tenant from `app_company_id()`). `REVOKE EXECUTE … FROM PUBLIC` is in the same migration as each `CREATE FUNCTION`. |

**The current proof is the one whose `generation` equals the state row's `generation`** — at most one proof can have it
(the unique constraint), so no ordering by a timestamp or an id is ever used. Issuing bumps the generation and records
the new value on the new proof; invalidating bumps it and records no proof, which leaves the previous proof behind the
state and therefore not current. Every bump is `generation = generation + 1` **on the row this transaction has locked**, so concurrent bumpers cannot allocate values out of lock order and no sequence or monotonic trigger is needed. Ids a caller supplies (`state_id`, `proof_id`) are UUID v7 from `IdGenerator`, so **no database-generated id** exists.

**Two separate steps, no first-caller special case and no NULL.** (1) *Ensure*: `INSERT … ON CONFLICT (company_id) DO NOTHING` at `generation = 0`; it never bumps. (2) *Lock, compare, bump*: `SELECT … FOR UPDATE` on the row, compare `expected_generation` (the issuer only), then `generation = generation + 1`. A company with no row is sampled as generation 0 after the ensure (`current_commission_coverage_generation` ensures, then reads). Two first-time issuers both sample 0: the first locks, matches and bumps to 1; the second waits, sees 1 and gets `COVERAGE_GENERATION_MOVED`. Two first-time invalidators serialise on the unique key and then on the row lock, and both succeed. The issuer never inserts: a missing row is `COVERAGE_GENERATION_MOVED`. A freshly ensured row at generation 0 has no proof at generation 0 (every proof carries a generation of at least 1), so it is closed.

### 2. The grant contract and the privilege matrix

The function owner `pospay_coverage_issuer` is `NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE
NOREPLICATION`, **a member of nothing and with no members** (`NOLOGIN` alone does not stop `SET ROLE` when a membership
exists), owns only the four functions and the trigger functions, holds `USAGE` on schema `public` and **no `CREATE`
anywhere** (the 53-1 pattern, with the same effective-privilege tests). It also needs `EXECUTE` on
`pg_catalog.pg_control_system()` (migration 0158 asserts the app role holds it; the same assertion is added here).

Every function sets its tenant explicitly: the app-callable functions use `app_company_id()` of the caller's existing
`withTenant` transaction; the dispatcher functions take the company as a parameter and **call `set_config('app.company_id',
…, true)` themselves**. So no policy needs a cross-tenant `USING (true)`.

**Privilege matrix** (a cell is the privilege and, after `/`, the RLS policy; «—» is no privilege; every existing privilege
not mentioned is unchanged):

| Object | `pospay_app` | `pospay_dispatcher` | `pospay_coverage_issuer` | `pospay_approval_reader` (53-1) | `pospay_owner` |
| --- | --- | --- | --- | --- | --- |
| `companies` (FORCE RLS; a read policy for the app role only today, `0002_…tenancy-rls.sql:11`) | existing | — | column `SELECT (id, deleted_at)` / `SELECT USING (id = app_company_id())` | — | owns; bootstrap superuser (ADR-0003) |
| `businesses` | existing | — | column `SELECT (company_id, id)` / `SELECT USING (company_id = app_company_id())` | — | owns |
| `outbox` | existing (`INSERT`) | existing (`SELECT`, five-column `UPDATE`) | column `SELECT (company_id, id, event_type)` / `SELECT USING (company_id = app_company_id())` | its own four-column `SELECT`, unchanged, not used here | owns |
| `consumed_events` | existing (`SELECT`, `INSERT`) | — | column `SELECT (company_id, consumer_id, event_id)` / `SELECT USING (company_id = app_company_id())` | its own three-column `SELECT`, unchanged | owns |
| `commission_coverage_state` | `SELECT` / `SELECT TO pospay_app USING (company_id = app_company_id())`; **no write, no row lock** | — | `SELECT`, `INSERT`, column `UPDATE (generation, bumped_at, reason)` / `SELECT`, `INSERT`, `UPDATE`, each `USING`/`WITH CHECK (company_id = app_company_id())` | — | owns |
| `commission_coverage_proofs` | `SELECT` / `SELECT TO pospay_app USING (company_id = app_company_id())`; no write | — | `SELECT`, `INSERT` / tenant-scoped the same way | — | owns |
| The two dispatcher functions | `EXECUTE` revoked | **`EXECUTE`** | owns | — | — |
| The two app functions | **`EXECUTE`** | `EXECUTE` revoked | owns | — | — |

Notes that make each line implementable: PostgreSQL requires `UPDATE` on at least one column for any `SELECT … FOR UPDATE`
or `FOR SHARE`, and applies the `SELECT` and `UPDATE` policies together to a locked row; the owner role therefore holds the
column `UPDATE` and the `UPDATE` policy, and **the app role never locks the state row itself**: its lock is taken inside the
gate function (section 7). No other role has any privilege on these objects. The catalog tests assert `ENABLE` **and**
`FORCE` RLS on **both** tables.

### 3. Who may issue: separated from the API by database privilege (the owner's first condition)

A facade running with the API's role is **not** a fence and is not proposed. `pospay_app` is the role of both the API and
the worker today, so the separation has to come from a credential the API does not hold. **The credential is the real
trust boundary.** Exactly what the tracked files show:

- `deploy/docker-compose.staging-shared.yml`: `DISPATCHER_DATABASE_URL` only in the `worker` service (line 116); the `api`
  service (lines 67–105) has none; `migrate` holds `POSTGRES_DISPATCHER_PASSWORD` (line 62) because the rating-claims data
  step connects as the dispatcher (`packages/db/src/data-steps/index.ts:93`). `deploy/docker-compose.staging.yml` has the
  same shape (`migrate` 108, `worker` 156, `api` none).
- The operator's coverage CLI (`report-commission-coverage.ts`) and `apps/worker/src/shared/config.ts:19` require it.
- **Launchers that hand it to an API process** (a `dist/main.js` of the API with the dispatcher URL in its environment):
  `apps/api/src/modules/files/__tests__/production.spec.ts:41`; `apps/api/test/production-otp-smoke.spec.ts:54`, both through
  `apps/api/test/built-smoke.ts:6`; and `scripts/notifications/email-production-smoke.mjs` (line 22 copies the whole
  environment, line 66 sets `DISPATCHER_DATABASE_URL`, line 89 gives the same environment to the API **and** the worker).
- Search run for this list: `grep -rIl "DISPATCHER_DATABASE_URL\|POSTGRES_DISPATCHER_PASSWORD\|dispatcherPassword\|dispatcherUrl"`
  over the tracked tree excluding `node_modules`, `dist`, `.git` and `.next`. Besides the files above it matches only worker
  sources and tests, the worker CLIs, `deploy/staging.env.example`, `.github/workflows/ci.yml` (throwaway passwords written
  to a CI `.env`, lines 90, 209, 286, 367; the compose services still choose their own variables) and documents. No other
  tracked file reaches an API process.

Why each does not weaken the fence: `migrate` and CI are not request-serving; the API's own sources never read the variable
(no hit under `apps/api/src` outside tests); the harness copies are throwaway. **But** three launchers give an API process the
credential, so nothing in code stops a deployment from doing the same. **A 53-2 code-PR task** (no code is edited here):
change all three launchers so the **API child's environment is built from an allowlist** and the dispatcher URL and its password reach **only the worker child**, and test that the API child's environment holds neither the dispatcher credentials nor `MIGRATION_DATABASE_URL`. What Git **cannot** show and stays an operator and owner fact: the live secrets and who
holds them, the real release process, and operator actions outside Git.

| | Who calls | What the caller can read and write after the change | What is new | What the API role still cannot do |
| --- | --- | --- | --- | --- |
| **1 (chosen, CS-Q55). Definer functions executable by `pospay_dispatcher`** | The coverage CLI, on the dispatcher credential the operator already supplies | The dispatcher keeps exactly its present table privileges and gains `EXECUTE` on two functions, the same shape as the idempotency sweep; it writes no proof table directly | One `NOLOGIN` owner role, four functions, the grants of section 2. **No new pool, secret or login role.** | `EXECUTE` the issue or generation-read functions; write either table; `SET ROLE` to the owner or the dispatcher |
| **2. A new `LOGIN` role `pospay_coverage`** | The coverage CLI, on a new `COVERAGE_DATABASE_URL` | The same functions; the dispatcher gains nothing | Everything of 1, plus a login role, a Dokploy secret and an env var. **The fence is real only if the new credential reaches the issuing command alone, not the worker's permanent environment** | The same as 1; a compromise of the dispatcher credential also cannot issue a proof |
| **3. Issuance only by an operator as `pospay_owner`** (like `pnpm platform:grant`) | A human with the owner credential for one command | The superuser credential; the function's checks are advisory because a superuser can bypass them | An operator script; no runtime role or grant | Everything: the API never holds the owner secret; the cost is the strongest credential in an operational procedure |

**Chosen: 1** (CS-Q55, item 1): the `pospay_dispatcher` account calls the limited definer functions only, and the API role cannot issue; the always-on worker process holds the credential that can issue, with no per-issuance approval. It amends the dispatcher sentence of CLAUDE.md §5 and the roles table of ADR-0003 §3
(«plus `EXECUTE` on the two coverage-proof functions») in the 53-2 code PR, as 56b-1 does for its grant.

### 4. Issuance: bound to a `COVERED` result, one database, and what the function verifies

**The CLI issues only from the full report of its own run.** `report-commission-coverage --issue-proof` is **refused
together with `--through`** and refused when `--to` is earlier than the UTC date of the run plus one day (section 6). It
**first checks, best effort against a wrong URL, that both connections reach the same database**: it reads `current_database()` and the cluster system identifier
on the app connection (the one the report uses) and receives the same two values from `current_commission_coverage_generation`
on the dispatcher connection, and refuses on any difference **before it runs the report**. That same call ensures the state row, so a wrong URL can leave a generation-0 row in the wrong database; such a row has no proof, is closed, and is harmless. This check does not detect a physical fork or a restored copy that keeps the database name and system identifier, and it cannot catch a caller that lies: the caller's database claim stays on the trusted list (section 12), and the fork case, a new proof issued through two connections to two copies with one identity included, is an operator procedure that this check does not detect (section 12, item 4(a)). It keeps the generation that call returned,
runs the report, and calls the issuer **in the same process from the returned report object**, only when
`status === 'COVERED'`, the four input kinds were all checked, `unmarked.total` and `notHandled.total` are 0 and the exit
code would be 0, passing the report's own `tipScope` and `throughId`, the generation it read, and the database name and
system id of the **report's** connection. **Before it calls the issuer, it runs the tip-record check of section 6 and passes the bound it checked as `verified_tip_bound`.** A non-`COVERED` report, a thrown error or a non-zero exit never reaches the function.

The function then re-verifies, holding the state-row lock (section 8):

1. The company exists and `deleted_at IS NULL`; the caller's `report_database` and `report_system_id` equal **this** database's
   (`COVERAGE_DATABASE_MISMATCH`). This catches an operator mix-up of URLs; it cannot catch a caller that lies (a trusted item).
2. The supplied business list equals **exactly** the company's businesses read inside the function (`COVERAGE_SCOPE_INCOMPLETE`).
3. **Two bounds, one rule.** `report_through_id` is the bound the report printed (ADR-0054 section 4, the evidence the operator
   attests); `verified_through_id` is the function's own maximum counted retained event id now. It refuses when
   `report_through_id > verified_through_id` and refuses unless **every** counted retained event at or below
   `verified_through_id` carries the `commissions.project-inputs` mark (`COVERAGE_UNMARKED_EVENTS`). A later function bound is
   safe **exactly when** every gap event is marked (an event is marked only with its projection, in one transaction) and the
   generation has not moved (a source write that goes through the runner's declaration or the invalidator would have bumped it; a writer outside them is not seen, section 12, item 3(b)); otherwise the run is repeated. Both
   bounds are stored.
4. The counted types and the consumer id are the function's constants; `p_version = commission_coverage_required_version()`
   (`COVERAGE_VERSION_REFUSED`); `tip_from <= tip_to`, real calendar dates (the `tip_to` comparison with the bound is item 7, after item 6).
5. The state row exists and `expected_generation` equals its generation under the lock (`COVERAGE_GENERATION_MOVED` otherwise). The value sampled for a company with no row was 0 after the ensure of section 1; the issuer never creates the row.
6. `verified_tip_bound` is present and equals the `tip_day_bound` the function computes itself from PostgreSQL's clock, **sampled once under the lock** (`COVERAGE_TIP_BOUND_MOVED` otherwise: this is what a run that crosses midnight, or a bound that moved between the report and the issuance, gets, and the operator repeats it). **This check comes before item 7**, so that refusal is never masked by `COVERAGE_SCOPE_INCOMPLETE`. The function enforces only that equality and presence: it cannot read the tip records (section 6).
7. `tip_to >= tip_day_bound`, against that same sampled bound (`COVERAGE_SCOPE_INCOMPLETE` otherwise). **One day is defined: the issue day is the UTC date of the function's own clock at the moment it issues**, and `tip_day_bound` and this check use the same sampled value. The CLI's `--to` pre-check against the run's start day is an early refusal only.

The function then does `generation = generation + 1` on the locked row, stores the proof with that new generation, and sets
`tip_day_bound` from its own clock (section 6).

**What it cannot verify, and says so**: (a) that the lines, salaries, package sales and tips revisions match their source
tables (needs orders and staff tables the owner role is not granted); (b) the quiet window, which must cover the **whole run** of any data step or repair and not only the transactions in flight (between batches nothing is in flight, so a report can pass on an intermediate state; section 12, item 3(d)); (c) that the comparison it ran used the rules of the version it states (the function itself refuses any version other than the required one, so the stored label cannot differ; whether the binary ran that release's comparison is part of (a), the correctness of the comparison); (d) that the tip range is complete; (e) that the caller's database claim is true; (f) the
integrity of the marks, section 12. The function **trusts the caller** for (a) to (e); `run_id`, `release` and `issued_by`
are stored, and approval requires the version to equal its own constant.

### 5. Invalidation (the owner's second condition): fail-closed where the database enforces it, an operator procedure where it cannot

A proof is valid only if **all** hold: it is the current proof (its `generation` equals the state's); its `version` equals
`commission_coverage_required_version()` and the approver's constant; its `database_name` and `system_id` equal the current
database's; its `counted_types` and `consumer_id` equal the current constants. **Anything else, including a missing state
row, is closed.**

**The one sound way to invalidate** is `invalidate_commission_coverage(state_id, reason)`, callable by `pospay_app` **on its
existing `withTenant` transaction**: it runs the two steps of section 1: ensure the row (insert-if-absent at generation 0, never bumps), then lock it and set `generation = generation + 1`. It takes **no caller-chosen value**, and `pospay_app` has **no write privilege** on the table (a column `UPDATE`
grant would let it write any value, and a lower one would revive a stale proof). Through invalidation alone, a compromised API can therefore only **deny**
approvals — it could already do that by other writes — and never restore a proof or open approval. (With a valid proof and an open switch it can still insert `consumed_events` marks that satisfy the ADR-0012 count: the trust item of section 12, item 2.) Two earlier alternatives are
**removed**: a direct `UPDATE` grant, and invalidation only by a dispatcher or owner caller, which cannot share the app
transaction of a data step or an API write (ADR-0038 runs tenant writes on `pospay_app`, line 38), so a report could issue a
proof between the bump's commit and the silent write.

| Coverage condition that changes | What invalidates the proof | When |
| --- | --- | --- |
| A release changes the counted types, the consumer id, the bootstrapped input kinds or the proof's rules | **The release's migration, in one transaction, replaces `commission_coverage_required_version()` and runs `UPDATE commission_coverage_state SET generation = generation + 1, reason = 'RELEASE'`.** The update takes row locks on the state rows its statement sees, which **conflict with the share lock an in-flight approval holds until its commit**, so it waits for those approvals and they finish under the old rules. **What holds after the commit:** every gate read that starts after it refuses a proof of the old version (the version check, independent of the bump), and the bump makes the proofs of the rows it saw not current. The issue function and the gate refuse any other version for every binary, and an old binary's own constant check also fails against a newer proof. **What does not hold:** a state row committed after the migration's `UPDATE` began is not in its snapshot, so a proof issued for it under the old version, with an approval that started before the migration commits, is not blocked. That window is closed by a **deploy-order obligation, not by the database**: no issuance and no first-time state row (the ensure of section 1, by any caller) for any company while a coverage-changing release migration runs (section 12, item 3(c)). A bump without a migration fails the constant test. **The same migration also replaces, together, every database predicate that embeds the coverage rules:** the issuer's constants (the counted types and consumer id), the type list of the outbox refusing triggers, **and the installed ADR-0012 pending-count function `public.statement_pending_commission_events`** (its counted types and consumer id), so a new-version proof is never stamped with old verification rules and the count and the proof rules cannot diverge; the parity test of section 10, test 9 compares the constants read from the installed functions and triggers with those of the worker and the approval binary. `migrate` runs before new containers (CLAUDE.md §10), and sets a short lock timeout as migration 0158 does, so it fails fast instead of queueing behind a long approval. The version only rises; lowering it is an explicit owner decision | At `migrate` |
| A write of source rows (service lines, line performers, sold package rows, employee salaries, tip revisions) **without** a counted event: a repair, an import, a migration data step | **Every transaction that performs such a write through the runner or an API write path first calls `invalidate_commission_coverage`** (a writer that bypasses them writes silently and is not seen, section 12, item 3(b)). For data steps (several `withTenant` transactions, e.g. `packages/db/src/data-steps/employee-name-keys.ts:38`; none of them calls `lockStatementPeriods` today. **Rule for data-step authors:** a step takes no period lock inside its callback, because the runner has already bumped on entering `withTenant` and a period lock after the state row would invert the order of section 7; a source-scan test over `packages/db/src/data-steps/**` fails when a step imports or calls `lockStatementPeriods`, which is the guard), the runner gives the step a `Database` whose `withTenant` calls the function at the start of every transaction for steps declared `coverage: 'INVALIDATES'`. A missing or unknown declaration is a **refusal to run** (type error plus a runtime check against the reviewed allowlist), not `'NONE'`. An API write path must emit the event or call the function in its transaction | In each transaction, **after any period locks it takes and before its first breaking write** (the global order of section 7) |
| A purge of counted outbox rows, or a removal or rewind of a covered projection table (the tables the `commissions.project-inputs` consumer writes), including a partial restore of either | **Refused by the database for outbox rows, a named procedure for the rest.** `BEFORE DELETE` row and `BEFORE TRUNCATE` statement triggers on the six counted types refuse (row triggers do not fire on `TRUNCATE`; the statement trigger also fires for a `TRUNCATE … CASCADE` that reaches `outbox`), and no runtime role has `DELETE`. An operator who must do it runs **one owner transaction**: first `UPDATE commission_coverage_state SET generation = generation + 1` for the affected companies (the row locks queue behind any in-flight approval), then drops the guards, makes the change, and recreates the guards before `COMMIT`, so an approval never sees a window without guards. The database cannot force that order or stop a session that skips the bump, so this is **not enforced by it** (section 12, items 3(a) and 4(c)). The fixtures that clean `outbox` as the owner session (section 12) run under `session_replication_role = replica` | Before the change, in the same transaction |
| A database **restore** | A restore into a **new cluster or database** changes `database_name` or `system_id`, so every earlier proof is closed. A restore that keeps both (point-in-time, or a **physical fork into another environment**, which keeps `system_identifier`, `docs/runbook.md:68`) is **not detected**: it is an **operator obligation with a runbook step added by the 53-2 PR**. Before any API starts on it, bump every generation (owner session) and switch the approval override off through the audited command of section 9. A **partial** restore of outbox rows, marks, source rows or a covered projection table is treated as a fork and also follows the bump-first order of the purge row. A consistent same-environment recovery (proof, generation, events and source rows rewound together) needs none. **Not enforced by the database** (section 12, item 4); the routing check of item 4(a) is repeated before every issuance there | At restore time, by procedure |
| A worker rollback to a release without a handler | **Not an invalidator.** The ADR-0012 count closes approval by itself (CS-Q43) | — |

What no database object can do, and the ADR states instead of claiming: force a **new** writer of source rows to call the
function (held by the registry's type, the runner, the allowlist test and review), and tell a physical fork from a recovery.

### 6. Which businesses and which days a proof admits

**Business.** A business **absent** from the proof's `business_ids` is **refused** until a new proof is issued. Admitting a new
business by `businesses.created_at` is removed: the app role holds `UPDATE` on the whole table (`packages/db/test/table-grants.ts:34-37`
and the businesses grants of `migrations/0002_2026-09-23_tenancy-rls.sql`), and the table has **no `deleted_at`**
(`packages/db/schema/tenancy.ts:62`). A company that adds a business needs one new proof before that business's first
approval: one quiet-window run.

**The tip upper bound is verified at issuance, not assumed (CS-Q55-ب).** `U = tip_day_bound` is the UTC date of the issue plus one day, taken from PostgreSQL's clock: the issuing command reads it from the same dispatcher-side call that returns the generation, and the issue function recomputes it from its own clock when it issues. A tip beyond `U` is not expected, because the producer refuses a session time more than 120 000 ms after the recording time (`SESSION_TIME_IN_FUTURE`, `packages/domain/src/session-time.ts:78`) and time zones span at most UTC+14, but the proof **no longer relies on that rule** and the producer's clock is not used. **The check:** before issuing, in the verification window, the issuing command runs an **existence check through the Orders boundary** over the company's original tip records, for **every business of the company**: does any tip revision exist on a session whose `business_date` is **greater than `U`**, with **no upper bound** (a bounded range such as one ending at `9999-12-31` would not cover every PostgreSQL date, so no upper cap is part of the contract). It runs on `pospay_app` inside `withTenant`, the privilege the report's tip reader already uses (`readCurrentSessionTips`, `apps/worker/src/modules/orders/queries/current-session-tips.reader.ts`, takes a bounded `{ from, to }` range). Commissions reaches it only through its port (a Port row in `docs/module-map.md`, added by the 53-2 code PR). **Any returned row, and any result it cannot trust (an error, a truncated page, an unknown business), is a refusal to issue.** **No grant is added to the function owner, which stays unable to read the orders tables.** If the existing reader does not support `business_date > U` with no upper bound, the 53-2 code PR adds a narrow existence read inside `orders` (module boundary respected), and if the existing `pospay_app` privileges do not suffice it reports the smallest separation it proposes instead of adding a grant. **What this check is:** a **caller check bound to the proof**, not database enforcement: the database enforces only that the stored `tip_day_bound` equals its own clock's bound and that the verified bound is present (section 4, item 6). It falls under item 2 (i) and (ii) of section 12, and a proof exists only if the check passed.

**Month, in days.** For a statement of month `M` with first day `F` and last day `L`, and `U = tip_day_bound`, the days that
can hold pre-bootstrap tips are `F … min(L, U)`. The month is admitted iff **`F > U`** or (**`tip_from <= F`** and
**`tip_to >= min(L, U)`**). Days of `M` after `U` (the bootstrap month's days after the issue day, and every later month) hold no original tip record, because the check above verified that none exists beyond `U`; tips saved after the issuance are later events, which the count covers. **Admission therefore requires a proof, and a proof exists only if that check passed**, for the bootstrap month and for later months alike; the range then decides as above. Each row is a test:

| Issue (UTC) / `U` | Month | Range | Result |
| --- | --- | --- | --- |
| 2026-11-22 / 11-23 | October | 2026-01-01 … 2026-11-23 | admitted (`min(L, U)` = 10-31) |
| 2026-11-22 / 11-23 | November (the bootstrap month) | 2026-01-01 … 2026-11-23 | admitted (needs `tip_to >= 11-23`) |
| 2026-11-22 / 11-23 | November | 2026-01-01 … 2026-11-22 | **refused** (day 11-23 unchecked) |
| 2026-11-22 / 11-23 | November | 2026-11-05 … 2026-11-23 | **refused** (days 11-01 to 11-04 unchecked) |
| 2026-11-22 / 11-23 | October | 2026-10-15 … 2026-11-23 | **refused** |
| 2026-11-22 / 11-23 | December | any range | admitted (`F > U`) |
| 2026-11-30 / 12-01 | December | 2026-01-01 … 2026-12-01 | admitted (`min(L, U)` = 12-01) |
| 2026-11-30 / 12-01 | January 2027 | any range | admitted (`F > U`) |
| 2026-11-22 / 11-23 | September | 2026-10-01 … 2026-11-23 | **refused** (`tip_from > F`) |

### 7. The approval-time check: the exact order

The lock order is global: **period locks, then the state row.** Inside the one `withTenant` approval transaction (no extra pool
or guard transaction, CLAUDE.md §6 connection budget), the order is **this, and FR-032 states the same**:

1. Capture `transaction_timestamp()` (ADR-0012 §1, before waiting). Then the **access re-check** (`recheckAccess()`: 403 `FORBIDDEN`, then `FEATURE_DISABLED` for the commissions feature) and the **authorized idempotent replay**: a retry with the same `Idempotency-Key` and payload fingerprint of a committed approval returns its stored result before any status re-check and before the period locks (a new execution runs the business-state conditions — status, switch and proof — only inside the callback, after the lock), in the same relative order as the other commissions routes (`recheckAccess()` then `runIdempotent`, `apps/api/src/modules/commissions/persistence/drizzle-commission-plan-version-transactions.ts:26-31`). FR-032 on `main` did not place the replay at all; this sentence adds it.
2. **One** ascending `lockStatementPeriods` call.
3. Recheck **permission** by the existing refusal convention: the uniform 403 (`FORBIDDEN`) first, so a caller who lost the permission learns nothing about the switch or coverage. The `commissions` feature is rechecked here as for the other routes (`recheckAccess()`, `commission-input-lock-scope.port.ts:37-39`).
4. Recheck the ended month and the status REVIEWED (422 `COMMISSION_PERIOD_NOT_ENDED`, 409 `COMMISSION_PERIOD_CLOSED`,
   409 `COMMISSION_STATEMENT_NOT_REVIEWED`).
5. **The coverage gate, under the state-row lock.** Call `read_commission_coverage_gate(state_id)`. Inside it, in separate statements: (i) *ensure*: `INSERT … ON CONFLICT (company_id) DO NOTHING` at generation 0 (the definer function does this; the app role has no write privilege and the owner role holds `INSERT`, section 2), so there is always a row to lock, including on a company's first approval and before the switch command's first run (a row created by this ensure is rolled back with a refused approval, so a company that was never enabled keeps no row); (ii) `SELECT … FOR SHARE` of that row, **held to the end of the approval transaction**; (iii) a fresh statement reading the current proof (the one with the state's `generation`), withheld when its version is not the required one or its database differs. The function refuses nothing: it returns the proof or nothing. **Then, with the lock held, the transaction evaluates in this precedence:** (a) the explicit-only approval switch (section 9; a dedicated read in a later statement, so under READ COMMITTED it sees what the command of section 9 committed before it released the row): off answers **403 `FEATURE_DISABLED`** (a technical ruling of the PosPay manager, 2026-11-22, part of the route contract), the existing envelope code the commissions routes already return for a disabled feature (`domain/errors.ts:4`; spec 059 lines 610-612), after the usual membership and permission checks and before any freeze; (b) the proof's validity (section 5's checks against the binary's constant, and section 6's business and month admission, pure TypeScript, unit-tested): failure answers 422 `COMMISSION_COVERAGE_NOT_PROVEN`; then, in step 7, (c) the ADR-0012 count: 409 `COMMISSION_UPDATES_PENDING`. **The three refusals keep this order: 403 `FEATURE_DISABLED`, then 422 `COMMISSION_COVERAGE_NOT_PROVEN`, then 409 `COMMISSION_UPDATES_PENDING`.** No new error key and no open question.
6. The fingerprint checks, the statement builder **once**, the blocking-issue and D-14 checks.
7. The ADR-0012 count through the `pospay_approval_reader` function with the **original pre-lock timestamp**. **Both the proof
   and the count must pass**; a refusal by the count stays 409 `COMMISSION_UPDATES_PENDING`.
8. The single update to APPROVED, the freeze and the post-freeze fingerprint check.

Because the share lock is taken before the switch read and the builder and held to commit, **no invalidation, issuance or switch change for this company can commit between the gate and the freeze, and a release migration's `UPDATE` cannot commit over this share lock on a row it updates.** The migration fence covers only the rows its statement saw (section 5). The order is global and has no cycle **as long as data-step authors keep the rule of section 5**: **period locks first, the state row second, everywhere.** The approval follows it; an invalidating API write path takes its period locks before calling the invalidator; the issuer, the release migration and the switch command take the state row alone. A test makes an invalidating writer that holds period locks run against an approval and asserts neither deadlocks.

### 8. Races

- **Invalidation racing an approval.** The approval holds the state row `FOR SHARE`; the invalidator's update waits (the
  approved statement precedes the breaking write), or the invalidator holds the row first and the approval waits, then reads
  the new generation and refuses.
- **Issuance racing an approval.** The issuer takes the row `FOR UPDATE`; an approval waits, then its fresh statement reads
  the new current proof; or the approval's share lock is held and the issuer waits.
- **A release migration racing an approval,** on a row its statement saw: the migration waits for the approval's share lock; or the approval's gate starts after the migration's commit and refuses the old-version proof. A row created after the statement began is outside this fence: the deploy-order obligation of section 5.
- **Two first-time issuers, two invalidators.** After the ensure (section 1) they serialise on the row lock. Issuers: one passes, the other gets `COVERAGE_GENERATION_MOVED`. Invalidators: each bump is applied to the locked value, so both succeed.
- **The switch command racing an approval.** The command (section 9) takes the state row `FOR UPDATE` and commits the bump, the override and the audit row together. If the approval holds `FOR SHARE` first, it reads the old switch and commits, so the approved statement precedes the change, and the command applies after it. On a company's first run both sides ensure the row first (the command as the owner role, the gate through its definer function), so a row always exists to lock. If the command holds the row first, the approval's gate waits for its commit and then reads the new switch: disabled answers `FEATURE_DISABLED`; enabled has bumped the generation, so any proof from before the enable is not current. **Resume after a repair uses the same single order (section 9):** enable (bumps), approval answers 422 until a full new report and a new proof issued on that generation, then approval passes.
- **Issue racing an invalidation.** The same lock. An invalidation that commits first makes `expected_generation` mismatch; one
  that commits after makes the issued proof not current at once.
- **The stale run.** The CLI reads the generation, **then** runs the report, then passes that value as `expected_generation`.
- **A batch commit between report and issue** (a data step): the next batch's bump either precedes the issue (mismatch,
  refused) or follows it (the proof is not current at once). **That does not make an issuance between two batches safe.** Between batches nothing is in flight, so the report can pass on the intermediate state and a proof can become current; an approval that freezes before the next batch's bump is not undone by it. The database does not prevent this: issuing during any data step or repair is forbidden by procedure (section 12, item 3(d)).

### 9. Opening approval: a concrete, audited switch

Nothing in the repository keeps approval closed per company today: there is **no approve route on this base**, and the estimate
routes sit behind the `commissions` feature flag, which `packages/db/src/seed.ts:45` seeds **on** for every flag. So 53-2
checks a second, independent condition, **default closed**:

- **The switch:** a company feature override for the flag `commission_statement_approval` with `enabled = true` and not
  expired, **read without any plan fallback**. The shared reader `readFeatureEnabled`
  (`apps/api/src/modules/identity/persistence/feature-reader.ts:20`) falls back to the plan's `feature_flags`, so it is **not**
  used for this flag: the 53-2 PR adds a dedicated identity read (`readExplicitCompanyFeature`: the company is not deleted, an
  override row exists, `enabled`, `expires_at` null or in the future, nothing else) behind a commissions-owned port bound at the
  root, with its Port row in `docs/module-map.md`. A plan that carries `commission_statement_approval: true` therefore changes
  nothing. The read happens **after the state-row lock** (section 7, step 5).
- **Who writes it and how it is audited.** `pospay_app` holds `SELECT` only on `company_feature_overrides`
  (`packages/db/test/table-grants.ts:59`), so the API cannot flip it. The operator path is one owner-role command
  (`pnpm platform:commission-approval --company <id> --enable|--disable --reason … --operator <name> --operator-email <email>`, like `pnpm platform:grant`) that, **in one
  transaction**, ensures the company's state row, takes it `FOR UPDATE`, bumps its `generation` (reason `SWITCH`), upserts the override (`reason`; `set_by` is the operator's `user.id`, which the command resolves from the operator email with the same lookup `platform:grant` uses for its target, `userIdOf` in `packages/db/src/platform-grants.ts`, and the command refuses when there is no such user. Today `platform:grant` and `platform_audit_log` identify the operator only by a free-text name (`granted_by` and `actor` are text, not UUID), so **no operator UUID exists in that path**; the only valid UUID source in the schema is a platform user's own `user.id`, and the 53-2 code PR must add the `--operator-email` argument and this lookup to the new command. This is needed because `company_feature_overrides.set_by` is a required UUID, `packages/db/schema/tenancy.ts:146`) **and inserts a row into `platform_audit_log`** with
  `action = 'commissions.approval_enabled'` or `'commissions.approval_disabled'` and `details = {company_id, reason}`. That table is
  the project's permanent audit for operator actions (insert-only, global, no tenant column; the action format
  `^[a-z]+\.[a-z_]+$` fits (letters, a dot, then letters or underscores: the two names above fit, an underscore before the dot would not); the actor column is the operator name the command takes, as `platform:grant` does (`packages/db/src/platform-grants.ts:67`), and `target_user_id` stays null; ADR-0003 §3 and its T9a-3 note keep platform actions out of the tenant `AuditLog`, which would force
  the script to invent a company). The override row holds only the current value; the audit row is the history (CLAUDE.md §8).
- **Both must hold, with the proof and the count.** A valid proof plus a zero count **do not** open approval by themselves.
  Opening a company = (1) the approved enable command, which bumps the generation (a proof issued before the enable is not current); approval then stays refused with 422 `COMMISSION_COVERAGE_NOT_PROVEN`; (2) a full new report; (3) a proof issued **on that generation** from a `COVERED` run; only then can approval pass. The same order resumes approval after a repair (section 12, item 3(d)); staging by the manager, any
  production company or first run by Waleed (PP-201 rule 4 and issue #1032). Shipping the 53-2 code opens approval for no
  company.
- **A fork starts closed.** After a physical fork or a partial restore (section 5) the operator switches every override of the
  new environment off through the same audited command, which also bumps that company's generation, before any API starts there. This is a
  runbook obligation, **not enforced by the database**.

### 10. Tests the 53-2 code PR must carry

1. **No proof** → 422 `COMMISSION_COVERAGE_NOT_PROVEN`, nothing frozen. A proof that is not current (generation behind), of another version, with other `counted_types` or `consumer_id`, of another database or `system_id`, a missing state row.
2. A business **absent** from the set (refused); a narrower set; **every row of section 6's boundary table**; the tip-record check of section 6 (test 14).
3. **A fresh company that was never enabled** (no state row): the approval answers 403 `FEATURE_DISABLED` and no state row persists, because the ensure ran inside the refused transaction and rolled back; separately, after the audited enable command has created the row and no proof exists, 422 `COMMISSION_COVERAGE_NOT_PROVEN`; **another company's proof** (isolation); the negative RLS tests for both tables; `ENABLE` **and** `FORCE` RLS asserted on both; the effective privileges of the owner role and of each caller exactly as the section 2 matrix lists them; `pospay_coverage_issuer` has no membership either way, no `BYPASSRLS`, no schema `CREATE`; `EXECUTE` is revoked from `PUBLIC` on all four functions.
4. A write to either table with the API's role is refused (`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`); `pospay_app` cannot set or lower a generation (only `invalidate_commission_coverage` raises it); the proof triggers refuse an owner session and the state `DELETE`/`TRUNCATE` triggers refuse it too; `EXECUTE` of the issue and generation-read functions is refused to `pospay_app` and every role except the chosen caller; `SET ROLE` to the owner and the dispatcher is refused.
5. The issue function, **in the order of section 4 (the `verified_tip_bound` check before the `tip_to` check)**: refuses an incomplete business list, an unmarked counted event at or below its bound, a report bound ahead of the database, a moved `expected_generation`, a version other than the required one, a database or `system_id` mismatch, an unknown or deleted company; stores both bounds; accepts a later bound only when every gap event is marked; **assigns the proof's generation only after it holds the lock** (two concurrent issuers that sampled the same generation: exactly one passes and the other gets `COVERAGE_GENERATION_MOVED`, so exactly one current proof; two concurrent invalidators both succeed); refuses `tip_to < tip_day_bound`; refuses a missing or moved `verified_tip_bound` (`COVERAGE_TIP_BOUND_MOVED`).
6. **Barriers, no sleeps:** an invalidation concurrent with an approval, an issuance concurrent with an approval, an issue concurrent with an invalidation, **two concurrent invalidators both succeed**, the **release migration against an in-flight approval on a row its statement saw, in both orders** (this proves only that the migration waits for that approval and that a gate read after the commit refuses the old-version proof; it proves nothing for a row created during the migration, which is the deploy-order obligation); issuance between committed batches of a multi-transaction data step (this proves only that the next batch makes that proof not current; it does not prevent an approval in between, procedure (g)); **the switch command against an in-flight approval in both orders** (a disable cannot commit under an approval that already passed the read; an approval waiting on the command sees the new value); a proof issued before an enable is not current after it; two first-time issuers (one passes, one `COVERAGE_GENERATION_MOVED`).
7. The CLI: a normally returned `NOT_COVERED` report, one with `tips: null`, a non-zero exit, a thrown error, `--issue-proof` with `--through`, `--to` before the UTC date plus one, and **connections whose database name or system identifier differ** never call the issuer (the check is best effort and says nothing about a fork with the same name and identifier); a `COVERED` report calls it once with its own scope.
8. **`DELETE` of a counted outbox row, `TRUNCATE outbox` and `TRUNCATE companies CASCADE` are refused** (PostgreSQL tests); no runtime role holds `DELETE` or `TRUNCATE` on `outbox`.
9. The constant equals `commission_coverage_required_version()` after migrations, and the counted types and consumer id read from the installed issuer, triggers and ADR-0012 count function equal those of the worker and approval binaries; **parity sequence:** (1) a migration adds a counted type (it replaces the issuer's constants, the outbox guards' type list and the count function together and bumps the generations), and the pre-migration proof is refused with 422 `COMMISSION_COVERAGE_NOT_PROVEN`; (2) after a full report, a **new** current proof is issued on the post-migration generation; (3) an event of the new type arrives with no consumer mark; (4) a fresh approval is refused with 409 `COMMISSION_UPDATES_PENDING`; the test fails if the installed count function and the proof rules diverge at any step; the catalogue hash test; every registered data step against the allowlist, an undeclared step refused; the runner bumps in **every** transaction of an `INVALIDATES` step; **every listed source table has a tenant- and business-qualified foreign-key path to `businesses`**, direct or through an existing parent reference (`packages/db/schema/orders.ts:105` `service_lines` to `service_sessions`, `:218` `line_performers` to `service_lines`).
10. **The switch:** a plan flag `true` with no override, an expired override and an override `false` each leave approval closed (answering `FEATURE_DISABLED`) with a valid proof and a zero count; the audited operator command writes the override and the `platform_audit_log` row in one transaction (both or neither); the flag on with no proof is refused; **ADR-0012 group 5 still passes** with a valid proof and the switch on, and a valid proof neither lowers nor bypasses the count. **Resume path:** enable → 422 `COMMISSION_COVERAGE_NOT_PROVEN` → full report → proof issued on the post-enable generation → approval passes; a proof issued before the enable is not current after it.
11. **The three launchers** (`production.spec.ts`, `production-otp-smoke.spec.ts`, `email-production-smoke.mjs`) build the API child's environment from an allowlist; a test asserts it holds neither the dispatcher credentials (URL and password) nor `MIGRATION_DATABASE_URL`, and only the worker child receives the dispatcher credentials.
12. The approval order of section 7, including **a revoked permission with no proof gets the 403, never the 422**, and the switch read after the state-row lock. **An approval retried with the same `Idempotency-Key` and payload after a committed approval whose response was lost returns the original success**, not 409 `COMMISSION_PERIOD_CLOSED`.
13. **Release projection check (supports the procedure of section 12 item 3(c); it is not database enforcement):** an old processor commits a mark and a matching source revision before shutdown while the projection still reflects the old rules → no proof is issued until the affected projections are rebuilt or verified by the release-specific check; and the check fails on a projection that reflects the old rules even when its revision is current; **rollback line:** a worker rollback across a projection-semantics change after a re-issued proof, with the switch left on and no bump, leaves the old proof current and an old processor free to mark events under the old rules, which the procedure forbids; the test asserts that following the procedure (switch off and bump before the rollback; restore the matching processor and verify the projections; then the section 9 order: the audited enable, approval answers 422, a full report, a proof issued on the post-enable generation) refuses approval until that proof exists, and **the test ends with an approval that succeeds after the proof**.
14. **Tip-record check (CS-Q55-ب; a caller check bound to the proof, not database enforcement):** a tip row exactly at the bound `U` is not a refusal, and a row at `U + 1 day` is refused; a row beyond the bound refuses the issuance; an error, a truncated page or an unknown business is a refusal (an empty page from a bounded range is **not** enough: the existence condition has no upper bound; the regression case with a stored `business_date` above year 9999 is in #1223 item 13); **the two clocks differing** (the application server's clock versus PostgreSQL's: the bound used is PostgreSQL's, the same one stored in the proof, whatever the application clock says); **a run crossing midnight** (the bound moves between the report and the issuance: `COVERAGE_TIP_BOUND_MOVED`, reported distinctly and never masked by `COVERAGE_SCOPE_INCOMPLETE`, then a repeat); **another company's data** (rows beyond the bound in another company never refuse this company, and this company's check sees only its own rows under `withTenant`); every business of the company is checked; and the function owner holds no privilege on the orders tables.

### 11. Alternatives removed by review rounds 1 to 3

- Invalidation only by a dispatcher or owner caller; a direct `UPDATE` grant; a bump once per data step.
- Admitting a new business by `created_at`; the issue date in the business's time zone as the tip cutoff.
- A sequence-based epoch with a monotonic trigger, a separate policy table with a minimum version, a latest-proof lookup by
  timestamp or id, and a delete trigger that bumps the state: replaced by the generation on the locked row, the version function
  and the refusing triggers, each one mechanism fewer.
- A reference to «the existing gate» that keeps approval closed, and the shared feature reader for the switch.
- A first-caller special case and a NULL `expected_generation` for a company with no state row: replaced by ensure (insert-if-absent at generation 0), then lock, compare, bump.

### 12. The owner's decisions (CS-Q55, answered 2026-11-23; technical, Waleed only, like ADR-0061)

1. **Who may issue, i.e. which credential is the trust boundary — chosen: option 1 of section 3** («حساب الخدمة الحالي (المقترح)»): the `pospay_dispatcher` account calls the limited definer functions only, and the API cannot issue. The options offered were 1 (an `EXECUTE` grant on an existing role), 2 (a new login role plus secret that must reach only the issuing command) and 3 (the owner credential in an operator step).
2. **The trust limits the database does not verify — accepted, exactly as the card named them and nothing wider** («اقبل حدود الثقة دي (المقترح)»; the alternative was additional in-database verification before execution, which would have delayed 53-2). The issuer is accountable for: (i) the **correctness of the comparison** of lines, salaries, sales and tips, including that it ran with the rules of the version it states (the function itself refuses any version other than the required one) and that the report is the one the issuance cites; (ii) the **completeness of the tip range**; (iii) the **quiet window** (for a multi-batch data step or repair, see item 3(d)); and (iv) that the **report and the issuance ran on the same database** (the same-database check is best effort against a wrong URL, see item 4(a)). Not new trust, and not a choice on the card: the integrity of `consumed_events` marks is pre-existing trust of the ADR-0012 count itself (`pospay_app` can insert them under RLS, `0006_2026-09-23_outbox-dispatcher-rls.sql:20`), stated for completeness; with a valid proof and an open switch, a compromised API role could satisfy the count this way.
   - **2b. CS-Q55-ب — answered 2026-11-23** («تحقّق فعلي من السجلات وارفض الإصدار لو فيه بقشيش قديم بعد الحد (المقترح)»): the tip-date assumption is removed from the trust list entirely. It is replaced by the tip-record check of section 6, performed by the issuing command on the existing privileges and bound to the proof (a caller check, not database enforcement; no new grant). The producer's rule is no longer relied on.
3. **Invalidations CS-Q54 required that the database does not enforce and that rest on a written operator procedure — accepted as documented procedures** («اقبل الإجراءات الموثقة للحالات دي (المقترح)»). The relaxation of CS-Q54's fail-closed condition applies **only to the cases (a) to (d) below, as procedures**, and is never described as enforced automatically: each is a window in which a stale proof stays current unless the procedure is followed. Procedure and exact limit for each:
   - (a) **Selective purge** of counted outbox rows. Procedure: one owner transaction: bump the affected generations first (taking the state-row locks), drop the guards, delete, recreate the guards before `COMMIT`. Limit: the owner role can skip the bump, and the guards stop only sessions that do not drop them.
   - (b) **A new writer of source rows** that omits its event and its runner declaration. Procedure: held by the runner's type, the allowlist test and review. Limit: a writer that bypasses the runner is not seen.
   - (c) **A coverage-changing release migration, mixed release and rollback.** Procedure: no issuance and no first-time state row for any company while the migration runs, and `migrate` before new containers; the proof version and the database constants for the counted types and consumer id (the issuer, the outbox guards and the ADR-0012 count function) change together in the same migration, and when a release changes how an existing counted event is projected, the processors of the older release (same consumer id) are stopped, **and the affected projections are rebuilt or verified by a release-specific check before any re-issuance; stopping the old processors alone is not enough**, because a revision and a consumption mark alone are not evidence of the new semantics (an ordinary replay is not assumed to re-create marks that already exist); no proof on the new projection is accepted before both. **A worker rollback across a projection-semantics change is itself a coverage-changing operation** (an old processor that comes back after a new proof can mark events under the old rules): before it, the approval switch is turned off and the generations are bumped; the switch stays off until the matching processor is restored and the projections are verified; then the **single resume order of section 9** applies: the audited enable (it bumps the generation first), approval answers 422 `COMMISSION_COVERAGE_NOT_PROVEN` until a full new report and a new proof issued on that generation; this is an operator procedure. Limit: an old processor can commit an old-rule projection and its mark **before** it stops; if that projection carries the current source revision, the report returns COVERED and the ADR-0012 count treats the mark as complete, so only the release-specific check catches it (an operator procedure, not database enforcement); an older worker that is still running can also mark an event for the old projection effect after a new proof, and the count then sees it as complete (not enforced by the database); approvals already past the gate before the commit finish under the old rules; a row created during the migration's statement and given a proof under the old version is not fenced; after the commit the old API's gate refuses an old-version proof, and a rollback to an older binary does not lower the required version.
   - (d) **A multi-transaction data step or repair.** Procedure: **no enable and no issuance while batches run**: the approval switch stays OFF (audited command) and issuance is stopped for the whole operation, pauses and failed runs included. After the run has finished successfully: the audited enable (it bumps the generation), then approval answers 422 `COMMISSION_COVERAGE_NOT_PROVEN` until a full new report and a new proof issued on that generation; approval then passes. Limit: between batches nothing is in flight and the database cannot see that a run is under way; a proof issued then can be current, and an approval that freezes against the intermediate state before the next batch's bump is not undone by it, and no correction is generated for a silent write.
4. **General operations risks the database cannot detect — accepted as operator procedures in the three cases** («اقبل الإجراءات في الحالات الثلاث (المقترح)»). As the PosPay manager presented the options (§64), rejecting would have asked for enforcement suited to **each** case (an environment identity addresses only the fork, not an in-database restore or projection rewind), and the owner could accept some cases and reject others. Procedure and exact limit for each:
   - (a) **A physical fork into another environment, or a restore that keeps the database name and `system_identifier` and is not a consistent same-environment recovery.** Procedure: before any API starts on the copy, switch the approval override off through the audited command, invalidate the inherited proofs (bump every generation), and verify operationally that the report connection and the issuing connection are routed to the same actual database (an operator check, not a database check). **This routing check is required before the API starts and again before every issuance or re-issuance in the forked environment, on the connections that run uses; if the routing cannot be confirmed for the run, there is no issuance.** Limit: the same-database check is best effort against a wrong URL and does not detect the copy. This covers **not only an inherited proof but also a new proof issued through two connections to two copies with one identity** (the report on one copy, the generation read, the mark check and the issuance on the other); until the procedure runs, a proof copied with the data is current and approval is open wherever the override was copied on.
   - (b) **Partial restore** of outbox rows, marks, source rows or a covered projection table. Procedure: one owner transaction that bumps the affected generations first (taking the state-row locks), restores, and only then commits. Limit: a restore that skips the bump leaves the old proof current over data that no longer matches it.
   - (c) **Removal or rewind of a covered projection table.** Procedure: as (b). Limit: no database object observes it; the ADR-0012 count does not see a projection that lost rows without losing events.
   Enforcing any of items 3 and 4 in the database would need objects this addendum does not add (for example event triggers on the covered tables, or an environment identity); that would be a separate decision. None of them is an automatic guarantee or counts as one. **What this answer does not do: it opens approval for no company, writes no gate or privilege code and takes no migration number; 53-2 code starts from follow-up #1223.**

**Fixtures the refusing triggers affect.** A search of tracked tests (not only application code) finds owner-session cleanup of
`outbox` or `companies` in: `apps/api/src/modules/orders/__tests__/package-sale-request.fixture.ts`,
`apps/worker/src/__tests__/report-commission-coverage-db.spec.ts`,
`apps/worker/src/modules/commissions/__tests__/commission-blocked-corrections-db.fixture.ts`, `replay-commission-inputs-db.spec.ts`,
`replay-commission-inputs-salary-db.spec.ts`, `packages/db/src/__tests__/rating-claims-discovery.spec.ts` (including a
`DELETE FROM companies`) and `rls-tenancy.spec.ts`. The 53-2 code PR changes each to clean up under
`SET session_replication_role = replica` in its owner session, and a shared helper keeps that one line in one place.

Consequences to accept, not alternatives: every version bump ships a migration that locks the state rows its statement sees;
a purge of counted outbox rows needs a deliberate trigger drop; each batch of an `INVALIDATES` data step takes a row lock on
the company's state row; a company that adds a business needs a new proof; the restore and fork obligations of sections 5 and 9.

**Not verifiable from Git, and therefore an operator or owner fact:** the live secrets and who holds them; the real release
management (the order of `migrate` and container starts on the live host); operator actions outside Git; whether a
restored database is a recovery or a fork.

### 13. Evidence read for this addendum (no code was changed)

- **Mark and handler share one transaction for a matched type.** `apps/worker/src/outbox/deliver.ts:64-75`: `if (!consumer.eventTypes.includes(event.eventType)) continue;` then, inside one `withTenant` transaction, `if (await markEventConsumed(tx, consumer.id, event.id)) await consumer.handle(tx, event);`; a failing handler rolls the mark back. In place since #24 (`6fab80970`, 2026-09-23). **The actual states for the rest:** a known event type with **no registered consumer** (`KNOWN_EVENT_TYPES`, `known-event-types.ts`) is skipped, the delivery still returns `delivered`, `published_at` is set (`packages/db/src/dispatcher.ts:134`) and **no mark exists**, so the event stays **pending in the ADR-0012 count until it is handled** (the 2026-10-08 and 2026-10-22 amendments, ADR-0012 line 161 onward); an **unknown** type throws `unknownEventType()`, retries, then parks. No release marks a counted type it does not handle.
- **Registration of the six types** (git history of `commissions.module.ts`): `ServiceSessionRecorded` and the line types in #790 (`89da91835`, 2026-11-02); `SessionTipsChanged` and `SalaryChanged` in #928 (`656a34fa2`, 2026-11-11); `PackageSaleChanged` in #1149 (`cf70114e2`, 2026-11-21). Before each date that type was published without a mark and stayed pending, so that period fails closed.
- **No purge of `outbox` in tracked files:** a search of the application, worker and `packages/db` sources and migrations, excluding tests, finds no `DELETE` on `outbox` and no retention job for it; the dispatcher has `UPDATE` on five columns only, and ADR-0012 forbids deleting an outbox row before its consumers commit. The claim is about **tracked files**; an operator session on a live database is outside it, which is why section 5 adds the refusing triggers. The only cleanup jobs found are for files and idempotency keys.
