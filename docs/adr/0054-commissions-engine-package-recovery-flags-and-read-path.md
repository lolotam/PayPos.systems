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

The bindings this slice needs, each one an interface **owned by commissions** in its `ports/` folder, implemented by a
provider-owned reader and bound at the composition root, the way the root-bound `DaySessionsPort` is
(`docs/module-map.md` §3):

| What it reads | Provider |
| --- | --- |
| the business timezone | `tenancy` |
| service names | `catalog` |
| notification recipients | `identity` |
| the employee's business and dated branch attachments (FR-018b, FR-033) | `staff` |
| customer full names (D-20) | `customers` |
| tips and package sales for the bootstrap (ADR-0041 §6) | `orders` |
| the names of the branches where the work was done, read live by the open month's view and review (they enter the statement fingerprint) and again at approval, which freezes them in the statement lines (CS-Q35 settled: freeze; 56-1b-fz removed the export's live `CommissionBranchNamesReader`, #718; the first statement builder, 51-1, names the port and 53-2 reuses it) | `tenancy` |

**Lines and salaries are not a binding.** Spec 059 D-15 (decided 2026-10-25) replays the retained `ServiceSessionRecorded`,
`ServiceSessionLinesAdded`, `ServiceLineChanged` and `SalaryChanged` events from the outbox through a typed replay facade
in `packages/db` (read as `pospay_dispatcher`, effect and mark through `pospay_app` `withTenant`), so commissions needs
no orders reader for them; how a legacy `SalaryChanged` without `business_id` is routed to a business during the replay is open: spec 059 50-3 item (e), `TODO(spec)`. See the ADR-0012 addendum of 2026-10-25.

A root-bound read adds a **Port row** to `docs/module-map.md` §3 and **no import arrow** and **no `reads:` line** (a
`reads` line is for an import arrow and must name its adapter file, so it is added only by a sub-PR that really needs an
import). 59-0 adds those Port rows to `docs/module-map.md` §3 in the same PR.

**The rule from D-16:** if a reader cannot be bound at the root, the sub-PR that needs it stops and adds an ADR and the
module-map row first.

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

## Open questions for the owner

- **CS-Q32** (batch 53, PP-37.1): decided on 2026-10-23 by Waleed and Abu Salem, fully automatic (rebuild and clear by the
  worker). A new ADR records the narrow company-id read and the self-clear before 56b-1.
- **CS-Q31** (may the dispatcher role also hold `SELECT` and `INSERT` on the tenant-free
  `operational_recovery_flags` table, or does the owner want a new narrow role `pospay_recovery`?) was decided on
  2026-10-23: the dispatcher role, as recommended (Waleed and Abu Salem).
  Link: [../specs/059-commissions-statements/owner-questions.ar.md](../specs/059-commissions-statements/owner-questions.ar.md)
