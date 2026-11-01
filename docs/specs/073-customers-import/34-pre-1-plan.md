# 34-pre-1 — Customer fields: implementation plan

Sub-PR of spec 073 (`docs/specs/073-customers-import/spec.md`, Delivery table row 34-pre-1). Planner draft for the
root orchestrator; an independent design review (Astra) has been folded in, and the root reconciles both before the
brief is dispatched. Status: **implemented and locally checked; independent Astra review accepted, final migration
0198 generated, canonical-runner checks passed; GitHub reviews and CI pending**. Initial MiniMax delivery and its first correction were reviewed by the root; the root
resolved the remaining small type, fixture and lint findings. No push or PR has been made.

Scope, exactly: the new customer scalar fields (birthday, gender, email), the per-business note, the column grants
and the overwrite guard (D-8, D-9, D-10), the spec 010 find-or-create accepting them, and one read endpoint for the
later customer card. **Not in scope:** country settings (34-pre-3), the reception form and the card UI (34-pre-2),
the import engine and the fill-empty writes of an existing customer (34b), any worker code.

## 0. Inputs and what supersedes what

| # | Constraint | Source | Effect on 34-pre-1 |
|---|---|---|---|
| S-1 | Gender is **optional** on creation in 34-pre-1. Omission stores NULL; no default, no guessed value, no INSERT trigger or constraint requiring it. Old reception screen and old image keep creating customers. A supplied value is validated. | Manager override, 2026-11-01, message labelled 18:58 Kuwait | Supersedes, **for 34-pre-1 only**, spec CIM-14 (§Acceptance), the contract line «The new-customer creation contract requires a valid `gender`» (§Contract requirements) and Astra point 1 «internal `NewCustomer` mandatory». CI-Q10 stays accepted; its activation is `TODO(spec)` owned by 34-pre-2. |
| S-2 | 34-pre-2 adds the gender field to the UI **and** activates required-on-new-create (contract + domain + matching test) in the same PR. Legacy lookup of an existing customer never requires gender. No flag, no rollout scaffolding. | Same 18:58 message | 34-pre-1 keeps the find-first shape (S-3) so activation is a one-function domain change. |
| S-3 | Find before create: SELECT the existing identity on the same transaction; only an absent identity reaches creation; INSERT … ON CONFLICT DO NOTHING; on conflict a separate SELECT of the winning row. | Astra 1 | Adopted (shape only — nothing in 34-pre-1 enforces gender presence). |
| S-4 | Company route accepts scalar fields only; a note needs the business or branch route. Route context is carried, not dropped. Branch → business resolved on the same transaction through `describeWorkspaces`. No arbitrary business selection, no silently ignored note. | Astra 2 | Two input schemas (§3). |
| S-5 | Card/profile read in `queries/`, guarded by the existing `create:customers:{company,business,branch}` + `@RequiresFeature('customers')`. No new permission or role. Business names in one batch call to the tenancy public index on the same transaction; no notes→businesses join, no per-note reader call. | Astra 3 | §6. |
| S-6 | The creation audit keeps its current five-field projection; `readSessionCustomer` and staff responses never gain profile PII. Driver errors sanitized on the new reads too. Code-point length limits, NULL-safe CHECKs, guard as SECURITY INVOKER with fixed `search_path` and `IS DISTINCT FROM`; 0188 grants and trigger preserved. | Astra 4 | §4, §5, §7. |
| S-7 | Test-only migration application by an external Vitest globalSetup wrapper, no production migrator or journal change. | Root brief + Astra 5 | §9. |
| S-8 | Release compatibility: the current admin `session-customer-field.tsx` sends no gender; nothing in 34-pre-1 may break it. Rollback proof required. Do not write a test expecting omission to fail. | Astra 6 + 18:58 | §8 R-tests. |

**Recorded:** the root has written the 18:58 sequencing into the spec (CI-Q10 summary, CIM-14 as `TODO(spec)` →
34-pre-2, Delivery rows 34-pre-1 and 34-pre-2) and into `owner-questions.ar.md` («تسلسل تفعيل النوع»). This plan
follows those files.

## 1. Data model (placeholder migration)

Final file: `packages/db/migrations/0198_2026-11-01_customer-fields.sql`. The initial `XXXX` draft was tested before
canonical metadata generation; the implementer did not edit the journal or snapshots. The manager granted the lane at 19:15 Kuwait on 2026-11-01, after #762
merged as `1df1f24b` (last migration 0197). After local implementation and proof, the root rebases on latest main,
assigns final numbers starting at 0198, generates metadata, then publishes. The root completed the rebase on
`f5e88520`, generated `0198_snapshot.json` and the journal entry, and retained the exact SQL body reviewed by Astra.
Structural snapshot comparison changes only `customers` and `customer_notes`. Expand-only, no data step, no
backfill. Statements separated by `--> statement-breakpoint` like every migration. **No `CONCURRENTLY` statement:**
the only indexes are on the brand-new, empty `customer_notes` table, created in the same migration as 0190, 0192 and
0193 do; no index is added to `customers` (the profile read is by primary key, the notes read by the primary-key
prefix). Only explicit recorded owner overrides supersede older specification text; this plan has no blanket
precedence over the spec or governing documents.

### 1.1 `customers` — five nullable columns

| Column | Type | CHECK (named, NULL-safe) |
|---|---|---|
| `birth_month` | `smallint` | `customers_birth_month`: NULL or 1–12 |
| `birth_day` | `smallint` | `customers_birth_day`: NULL or 1–31 |
| `birth_year` | `smallint` | `customers_birth_year`: NULL or 1–9999 (calendar structure only; see Q-3) |
| `gender` | `text` | `customers_gender`: NULL or `IN ('female','male')` |
| `email` | `text` | `customers_email`: NULL or (`char_length(email) BETWEEN 3 AND 254` and `email = btrim(email)` and `position('@' in email) > 0` and `position('.' in email) > 0` and no character in `[\x00-\x1F\x7F-\x9F]`) |

Plus one table-level CHECK `customers_birthday_shape`:
- `birth_month` and `birth_day` are both NULL or both set;
- `birth_year IS NULL OR birth_month IS NOT NULL`;
- the day exists in the month: ≤ 29 for February, ≤ 30 for April, June, September, November;
- `NOT (birth_month = 2 AND birth_day = 29 AND birth_year IS NOT NULL AND NOT <leap(birth_year)>)`.

Every predicate is written so that NULL columns pass (`col IS NULL OR …`), because a CHECK that evaluates to NULL
passes silently only by accident; the tests assert each refusal explicitly (§8). Adding the CHECKs scans `customers`
once under the ALTER's lock; every new value is NULL, so the scan cannot fail. If root prefers a shorter lock,
`ADD CONSTRAINT … NOT VALID` then `VALIDATE CONSTRAINT` in the same file is the alternative — a root choice, not
required for correctness.

Gender values are stored as the English codes `female` / `male`; ذكر / أنثى are display strings for 34-pre-2 and
the import template (i18n), never stored.

### 1.2 Grants and the overwrite guard (D-9, CI-T8)

- `GRANT UPDATE (birth_month, birth_day, birth_year, gender, email) ON customers TO pospay_app;` — the fill-empty
  writes of 34b need exactly these; nothing in 34-pre-1 issues such an UPDATE. `updated_at` is already granted by
  0188. The `customers_update` policy from 0188 already covers UPDATE on both sides; no new policy.
- New function `customers_profile_guard()`: `plpgsql`, `SECURITY INVOKER`, `SET search_path = pg_catalog, public`,
  `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO pospay_app`, a `BEFORE UPDATE … FOR EACH ROW` trigger
  `customers_profile_guard`. For each of the five columns: `IF OLD.<col> IS NOT NULL AND NEW.<col> IS DISTINCT FROM
  OLD.<col> THEN RAISE … USING ERRCODE = '23514', CONSTRAINT = 'customers_profile_set_once'`. NULL → value passes;
  value → other value or value → NULL is refused. The message carries no value. Same shape as 0188's
  `customers_opt_out_guard`, which stays untouched (function, trigger, grants).
- Per-column, as CI-T8 says literally. Q-4 records the birthday-as-a-unit alternative for root.

### 1.3 `customer_notes` (D-8)

```
company_id  uuid        NOT NULL  REFERENCES companies
customer_id uuid        NOT NULL
business_id uuid        NOT NULL
note        text        NOT NULL
created_at  timestamptz NOT NULL
PRIMARY KEY (company_id, customer_id, business_id)
FOREIGN KEY (company_id, customer_id) REFERENCES customers (company_id, id)
FOREIGN KEY (company_id, business_id) REFERENCES businesses (company_id, id)
CHECK customer_notes_note: char_length(note) BETWEEN 1 AND 500 AND note = btrim(note)
INDEX customer_notes_business_idx (company_id, business_id)
```

The primary key covers the customer FK and the profile read (prefix `company_id, customer_id`); the extra index
covers the business FK. `ENABLE` + `FORCE ROW LEVEL SECURITY`; policies `customer_notes_select` and
`customer_notes_insert` `TO pospay_app` on `company_id = app_company_id()` (company scope, CI-Q17: every business of
the company reads every note); `GRANT SELECT, INSERT` only — no UPDATE, no DELETE (no edit screen until phase 2,
CI-Q14). No `updated_at` (immutable row). No `id` column: the composite key is the identity, per D-8.

### 1.4 Drizzle schema

`packages/db/schema/customers.ts`: the five columns with matching `check(...)` entries and the new
`customerNotes` table (same file; `schema/index.ts` already re-exports it). One-line comment on `birth_year`
(«السنة اختيارية، فمش بنستخدم date») per CLAUDE §3.1. The final `0198_snapshot.json` was generated from this schema
after the granted-lane rebase; the earlier draft-only snapshot drift is resolved.

## 2. Domain (`apps/api/src/modules/customers/domain/`)

Pure, Arabic JSDoc on every export, exhaustive unit tests, no database:

- `profile.ts`
  - `validateBirthday({ day, month, year? })` — the same calendar rules as `customers_birthday_shape`, including
    Feb 29 with and without a year; throws `InvalidCustomerProfileError` (no value in the message).
  - `isEmailShape(value)` — the CI-Q11 literal rule mirrored from the CHECK (an `@` and a `.`, trimmed, ≤ 254
    code points, no control characters). Q-2 records the stricter option.
  - `noteLength(value)` — code-point count (`[...value].length`); the contract and the CHECK both use code points
    (S-6). Spec 010's `name` keeps its existing rule untouched.
- `customer.ts` — `CustomerRecord` gains nothing that leaves the reception DTO. `customerForReception` stays the
  five-field projection and its JSDoc states why it must never grow (it is the audit `after` body).
- `errors.ts` — `InvalidCustomerProfileError` (code-only message, like `InvalidCustomerPhoneError`), and
  `CustomerNoteNeedsBusinessError` only if §3's schema split cannot express the company-route refusal (it can; do not
  add it unless needed).
- **No `requireGenderForNewCustomer` in 34-pre-1.** 34-pre-2 adds it (S-2). The JSDoc of the creation path carries
  `TODO(spec): CI-Q10 activation in 34-pre-2`.

## 3. Contract (`packages/contracts/src/customers.ts`, `customers-openapi.ts`)

- `customerProfileFields` (internal object): `gender: z.enum(['female','male']).optional()`,
  `birthday: z.strictObject({ day: int 1–31, month: int 1–12, year: int 1–9999 optional }).optional()`,
  `email: trimmed string, code-point refine 3–254, shape refine, withoutControlChars, optional`.
- `findOrCreateCustomerInput` (company route): the existing `phone`, `name`, `locale` **plus** the three scalar fields;
  still `z.strictObject`, so a `note` key is an unknown key → `VALIDATION_FAILED` (S-4). The existing
  `{ phone, name, locale }` body parses unchanged (R-2).
- `findOrCreateScopedCustomerInput` (business and branch routes, new `.meta({ id })`): the company schema plus
  `note: trimmed string, code-point refine 1–500, reject NUL, optional`. Preserve interior newlines: notes are free
  text. Do not impose the email control-character rule or a URL/rating-link restriction on notes.
- `customer` response: **unchanged** (`id, name, locale, opted_out, phone`). Backward compatible; it is also the audit
  projection.
- `customerProfile` response (new): `id, name, locale, opted_out, phone` (masked, same pattern),
  `birthday: { day, month, year: int | null } | null`, `gender: 'female'|'male'|null`, `email: string|null`,
  `notes: [{ business_id, business_name_ar: string|null, business_name_en: string, note, created_at }]`.
- OpenAPI: company `find-or-create` uses the company schema; `scopedCustomerPath` (business, branch) uses the scoped
  schema; three `GET …/customers/{customerId}/profile` paths (§6) with the same company-header and error envelope
  conventions as the existing operations.
- Calendar validity of the birthday is the domain's (rule D-3: one validator); the contract carries only the
  structural ranges, and the use case calls `validateBirthday` before any write.
- **Error codes:** every new refusal (bad birthday, email, note, gender, a note on the company route) maps to the
  existing `VALIDATION_FAILED`. No new code, so `apps/api/src/shared/errors.ts` and `packages/i18n` stay untouched.
  The existing phone → `INVALID_CUSTOMER_PHONE` mapping is unchanged.

Admin's `apps/admin/src/orders/api/use-session-customer.ts` parses with `findOrCreateCustomerInput` and posts to the
branch route; the body it produces is valid for the scoped schema too, so **no admin source edit**. The generated
`openapi.json` and both `schema.d.ts` change and are regenerated by root (§10), never hand-edited.

## 4. Use case and persistence (write path)

`use-cases/find-or-create-customer/`:

- Command gains `scope: { kind: 'company' } | { kind: 'business', businessId } | { kind: 'branch', branchId }` and
  the optional profile fields + note. The controller passes the route parameter it already receives instead of
  dropping it in `find()`.
- Flow inside **one** `transactions.run` (one `withTenant`, no nested or concurrent transaction, CLAUDE §6 budget):
  1. `normalizePhone` (unchanged; before the transaction, so an invalid phone opens nothing).
  2. Domain checks of supplied profile fields (`validateBirthday` etc.) — also before the transaction.
  3. `scope.findByPhone(phone)` — existing identity → return it, **write nothing**: the supplied profile fields and the
     note are ignored, no audit, response = `customerForReception(existing)` (S-3; fill-empty is 34b's, Q-1).
  4. Absent → resolve the note's business: business route → `businessId`; branch route → `scope.branchBusiness(
     branchId)`; company route has no note by contract.
  5. `scope.create(newCustomer)` → `INSERT … ON CONFLICT (company_id, phone) DO NOTHING RETURNING …`; nothing
     returned → `SELECT` the winner and return it as existing (`created: false`, no note, no audit). Profile columns
     omitted → NULL.
  6. Created → insert the note row (if any) with `created_at = clock.now()`, then the audit exactly as today:
     `after: customerForReception(row)` — five fields, never the profile (S-6).
- `NewCustomer` gains optional `gender?`, `birthday?`, `email?`; no default anywhere.
- Persistence keeps `safely()` around every new statement (find, create, note insert, branch-business read) so a
  driver error that echoes input never reaches a log or response; the work's own typed errors are rethrown as today.
- `branchBusiness` is implemented in a new persistence adapter that calls `describeWorkspaces(tx, [{ scope: 'BRANCH',
  scopeId: branchId }])` from `../../tenancy/index.ts` and reads `businesses[0].id`. The guard already proved the
  branch belongs to the company; a `null` result is a broken invariant → plain error → 500, not a 404.
- Concurrency: two first-time callers race on the INSERT; exactly one row, one audit, one note (the loser's note is
  not written, because the loser did not create). CUS-03 extended (§8).

## 5. Privacy (D-10, S-6)

- No new field in a log line, error message, audit row or exception text. The audit `after` keeps the five keys.
- `readSessionCustomer` (used by `orders`) and every staff/orders response are untouched.
- The pipe maps parse failures to codes only: `new ApiError(code)` with **no `details`**, exactly as
  `CustomerInputPipe` does today; Zod issue text, paths and received values are never echoed. The new scoped pipe
  keeps the same shape.
- **Logger backstop (CI-T6, D-10).** `packages/observability/src/redaction.ts` `sanitize()` walks every logged
  object at any depth. It already redacts email keys (`isEmailKey`), phone keys (masked) and request/payload bodies
  (`PRIVATE_PAYLOAD_KEYS`), and an email value inside free text via `EMAIL_OR_URL`; it has **no rule** for birthday,
  gender or note keys. The plan adds one narrow rule there: an exact normalized key set
  `birthday, birthdays, birthmonth, birthyear, birthdate, gender, genders, note, notes, customernote, customernotes`
  redacted under the same `maskPhones` branch as `isEmailKey` (normalization already folds `birth_day` /
  `birthDay` into `birthday`). Exact keys, not suffixes, so unrelated `*note` keys elsewhere are not swept. This is
  defence in depth: nothing in 34-pre-1 should log a profile object at all. New spec
  `packages/observability/src/__tests__/customer-profile-redaction.spec.ts`: a nested profile object, an array of
  notes, snake/camel spellings → redacted; an unrelated key (e.g. `footnote`, `noteCount`) untouched; email and phone
  behaviour unchanged. Root runs the whole observability suite (existing `redaction.spec.ts`, `leak-paths.spec.ts`,
  `public-surface.spec.ts`) to catch an over-redaction regression; if `note`/`notes` breaks an existing assertion the
  implementer reports it rather than changing that test.

## 6. Read path — customer profile for the later card

- Routes (one controller method each, same guards as find-or-create, `@RequiresFeature('customers')`):
  `GET /v1/customers/:customerId/profile` (`create:customers:company`),
  `GET /v1/businesses/:businessId/customers/:customerId/profile` (`create:customers:business`, `{ business }`),
  `GET /v1/branches/:branchId/customers/:customerId/profile` (`create:customers:branch`, `{ branch }`).
  Grounded access: the same staff who may find/create the customer may see the card (CI-Q14); every scope sees all
  of the company's notes (CI-Q17). The route scope only gates entry; it does not filter notes.
- `queries/customer-profile.query.ts` (imports only `packages/db` and `packages/contracts`): two reads on the same
  `tx` — the customer by `(company_id, id)` and its notes by `(company_id, customer_id)` ordered by `created_at,
  business_id`. Masking of the phone happens in the query projection (SQL `'***' || right(substring(phone from 2), 3)`) or through
  the existing `maskPhone` — neither `queries/` nor `http/` may import `domain/` (import matrix), so the plan uses the
  SQL projection and the raw phone never leaves the database. The result-shape test asserts it equals
  `maskPhone(phone)` for the same row, including the minimum normalized phone `+12` → `***12` (tests may import
  domain). Strip the leading plus before taking the suffix.
- Business names: extend the existing `tenancy/queries/business-names.query.ts` with the narrow
  `businessNamesByIds(tx, companyId, businessIds)` reader and export it from `tenancy/index.ts`. Its result contains
  only requested business IDs and their names. Add a result-shape/EXPLAIN test for this reader. An injected context
  adapter (`persistence/workspace-names.adapter.ts`) calls it **once** for the distinct business IDs in notes on the
  same `tx`; no call for an empty set. Retain `describeWorkspaces` only for branch→business resolution. The
  controller uses an injected read-side context interface beside the query (no persistence import), opens one
  `withTenant(companyId, tx => …, { userId })`, and composes the profile on that transaction. No notes→businesses SQL
  join, no per-note call, no loading all company businesses and branches.
- Not found, soft-deleted (if `customers` ever gains `deleted_at`) or another tenant's id → `ApiError('NOT_FOUND')`,
  identical bodies.
- Pattern to copy: `apps/api/src/modules/staff/http/attendance-board.controller.ts` (DATABASE token, injected
  context symbol bound in `customers.module.ts`, `ZodValidationPipe` on the UUID param).
- `docs/module-map.md` reads: declare both `customers -> tenancy.describeWorkspaces` and
  `customers -> tenancy.businessNamesByIds` at `apps/api/src/modules/customers/persistence/workspace-names.adapter.ts`.
  Follow the existing YAML syntax. The `customers → tenancy` arrow already exists.

## 7. Wiring

`customers.module.ts` binds the new adapter into `createCustomerTransactions` and the profile controller's context
symbol. `index.ts` exports nothing new (no other module consumes the profile).

## 8. Tests (to write in the slice; root runs them)

**Unit (no DB):** `domain/__tests__/profile.spec.ts` — every month boundary, Feb 29 ± year, leap/non-leap/century
years, day without month, year without day/month; email literal-rule accept/refuse table incl. 254/255 code points
and an astral-plane character; note 500/501 code points, multiline content retained, NUL refused. Contract spec — both schemas, unknown `note` on the company
schema refused, old body accepted, gender enum, birthday structure; OpenAPI publishes the three profile operations
and the scoped schema on business/branch paths. Use-case spec (fakes) — existing identity writes nothing even when
fields and a note are supplied; created with/without gender; note only on creation; branch business resolved;
audit `after` deep-equals the five-field object.

**Integration (`apps/api/src/modules/customers/__tests__/`, real Postgres, §9 wrapper):**
- create via business route with every field + note → row and note stored, audit five keys, response unchanged;
- create via branch route → note's `business_id` is the branch's business;
- create via company route with scalar fields; company route + `note` → `VALIDATION_FAILED`, nothing written;
- **gender omitted → created with `gender IS NULL`** (S-1; there is no test expecting omission to fail);
- invalid gender / birthday / email / note → `VALIDATION_FAILED`, nothing written, no phone or value in response,
  audit or captured logs;
- existing customer + new fields + note → nothing changes (name, locale, opt-out, NULL profile, no note row, no audit);
- CUS-03 race extended with notes: one customer, one note, one audit;
- profile GET from all three scopes shows notes of two businesses with names; other tenant's id → `NOT_FOUND`;
  PII-free log capture on the profile path;
- the existing CUS-* tests stay green unmodified except where an assertion enumerates columns.

**Query tests (`queries/__tests__/customer-profile.query.spec.ts`):** result shape incl. masked phone and NULL fields;
`EXPLAIN (ANALYZE, FORMAT JSON)` on meaningful synthetic fixture volume checks indexed access through
`customers_pkey` and `customer_notes_pkey` with normal planner settings. Test the batch tenancy reader with
multiple requested IDs, an empty set and cross-company isolation; its EXPLAIN fixture must also be meaningful.
Do not treat a handful of rows with `enable_seqscan=off` as sufficient performance proof.

**DB (`packages/db`):**
- `rls-customers.spec.ts` — the UPDATE-allowed list becomes `birth_day, birth_month, birth_year, email, gender,
  opted_out_at, updated_at`; the not-allowed list stays `company_id, created_at, id, locale, name, phone`; each CHECK
  refuses its bad values as owner; the profile guard: NULL → value allowed, value → other / NULL refused with
  `customers_profile_set_once`, for each column, as `pospay_app`; the 0188 opt-out tests unchanged.
- new `rls-customer-notes.spec.ts` — cross-tenant read = 0 rows, cross-tenant insert = error, UPDATE/DELETE refused,
  FK to a customer or business of another company refused, the 500-code-point CHECK, the index exists.
- inventories: `tenant-table-inventory.ts` + `customer_notes`; `table-grants.ts` + `customer_notes:INSERT`,
  `customer_notes:SELECT`; `customer-grants.ts` the five new column grants; `function-inventory.ts` the
  `customers_profile_guard` entry (`prosecdef: false`, `proconfig: ['search_path=pg_catalog, public']`).

**R — rollback / old-image compatibility (S-8, required by the 18:58 message):**
- R-1 the exact INSERT the current persistence issues (`company_id, id, name, phone, locale, created_at,
  updated_at`, `ON CONFLICT (company_id, phone) DO NOTHING`) succeeds as `pospay_app` on the expanded schema and leaves
  all five profile columns NULL;
- R-2 the old request body `{ phone, name, locale }` parses against both new input schemas, and the admin client's
  `findOrCreateCustomerInput.parse` output posted to the branch route creates a customer (integration);
- R-3 the old opt-out UPDATE (`opted_out_at, updated_at`) still works and 0188's one-way guard still refuses;
- R-4 the old SELECT column list still reads a row created by the new code with every profile field set;
- R-5 no INSERT trigger exists on `customers` (catalog assertion), so a NULL-gender insert can never be refused by the
  schema in this phase.

## 9. Initial draft-only test approach (historical)

Facts from `packages/db/test/global-setup.ts`: it migrates `pospay_tpl_<runId>` from the journal, sets
`ALLOW_CONNECTIONS false`, waits for `pg_stat_activity` to drain, then `project.provide('pg', {...env, template,
runId})`; teardown drops `pospay_test_<runId>_%` and the template. `test-database.ts` clones `pg.template` per spec
file. The runner reads only journaled files, so the placeholder is invisible to it.

Approach (root-only, **outside the repo**; nothing added to the repo). The root has drafted it as
`F:/Dev/Worktrees/PosPay/briefs/34-pre-1/draft-global-setup.mjs`, `db-vitest.config.ts` and `api-vitest.config.ts`;
the root reviews them against the steps below before the first run. The implementer never sees or runs them.

1. `global-setup-34pre1.ts` imports the repo's default `setup` by absolute path and calls it with a proxy of `project`
   whose `provide('pg', value)` captures `value` instead of forwarding it.
2. After `setup` resolves: as owner on `postgres`, `CREATE DATABASE "pospay_test_<runId>_<8hex>" TEMPLATE
   "<baseline>"` under the same `pospay:clone-template` advisory lock (the name matches `TEST_DB` and the teardown
   pattern, so cleanup and the leftover sweep already cover it).
3. Connect to the clone as owner, split the placeholder SQL by `--> statement-breakpoint`, apply it in one
   `sql.begin` (valid because the file has no `CONCURRENTLY`), close, drain `pg_stat_activity`, `ALTER DATABASE …
   ALLOW_CONNECTIONS false`.
4. Forward `provide('pg', { ...value, template: <clone> })` with the **same** `runId`; return the original teardown,
   and call it on any failure in steps 2–3 before rethrowing.
5. Two external configs (plain objects, mirroring `apps/api/vitest.config.ts` and `packages/db/vitest.config.ts`) with
   `globalSetup` **replaced** by the wrapper (not appended — two bootstraps would build two templates); `postgres`
   resolved with `createRequire('<repo>/packages/db/package.json')`.
6. Run on the private lane only: `node scripts/test-db/lane.mjs up <lane>`, `pnpm --filter <pkg> exec vitest run
   --config <external> --root <abs pkg dir> [files]`, then `lane.mjs down <lane>`. Root confirms the Vitest CLI
   accepts an out-of-root config first; if it does not, fall back to a config placed in the brief directory that
   sets `root` explicitly.

The draft phase changed no production migrator, canonical metadata or repo test hook. After the lane grant,
the root numbered 0198 and ran `db:generate`. Final tests call the repository's original global setup and canonical
migration runner, with only external private-container ownership verification; no draft SQL is injected there.

## 10. Checks the root runs (none is claimed passed by this plan or by the implementer)

1. `pnpm --filter @pospay/contracts typecheck lint test`; same for `@pospay/db`, `@pospay/api` and
   `@pospay/observability` (typecheck, lint incl. `max-lines`, boundaries, cycles; the full observability test
   suite for the redaction change).
2. `pnpm lint:docs`; `pnpm module-map:check`.
3. `pnpm contracts:openapi`, `pnpm --filter @pospay/admin api:generate`, `pnpm --filter @pospay/pos api:generate`,
   then both `api:check`; inspect the generated diff.
4. DB and API integration via the §9 wrapper on the private lane: `rls-customers`, `rls-customer-notes`,
   `privileges`, function inventory, tenant-table/grant inventories, customers `__tests__`, the new query spec, and
   `identity/__tests__/role-followups.spec.ts` plus any route/guard declaration test (PP-7.1) that enumerates routes.
5. Admin tests touching `use-session-customer` / `session-customer-field` (unchanged source; they must stay green).
6. CI greps: no `drizzle|sql|fetch|axios` in `use-cases/`; no `Date.now()`/`randomUUID()` in the use case.
7. Guard skills: `clean-code-guard`, `test-guard`, `docs-guard`.
8. **Root-only after local proof (lane granted at 19:15):** rebase latest main, renumber from 0198,
   `pnpm db:generate`, canonical-runner tests, push with explicit refspec and PR. Full `pnpm check` on exact CI head.

PR completion items (root, not implementer): the `PP-102`, `PP-103`, `PP-105` index rows in
`docs/owner-decisions.ar.md` (spec, Delivery notes); the 18:58 override recorded; roadmap status after merge.

## 11. Root review resolutions (none blocks local implementation)

- **Q-1** Note or profile fields supplied for an **existing** customer through find-or-create are ignored and the
  response is unchanged (spec: only the future import fills empty fields). The `Customer` response has no `created`
  flag, so 34-pre-2's UI cannot tell «saved» from «ignored» without the profile GET; 34-pre-2 must show the card
  after find-or-create. Root accepted this existing-customer behaviour; no fill-empty write belongs in this slice.
- **Q-2** Email rule: literal CI-Q11 (an `@` and a `.` anywhere) vs a stricter shape (one `@`, non-empty local part,
  a dot inside the domain). Plan uses literal; stricter would be a new rule.
- **Q-3** Birth year: only structural bounds (1–9999). A future year or an age limit is a business rule nobody gave;
  not added. Root accepts structural bounds only; any later change is a feature question for 34-pre-2/34b.
- **Q-4** Guard per column (CI-T8 literal) allows filling `birth_year` later on a stored day/month. 34b's import
  must then decide whether a row's year may join a different stored day/month; a 34b design note, not 34-pre-1.
- **Q-5** The profile GET reuses `create:customers:*`. Grounded (same people find and register the customer), but
  the verb reads oddly; a `read:customers:*` permission would need a catalog change and an ADR — not proposed.

## 12. Material risks

- **R-1 release ordering:** CI-Q10 is not enforced until 34-pre-2. Customers created between the two releases may
  have NULL gender, the same as legacy rows, and nothing backfills them. Accepted by the 18:58 override.
- **R-2** 34-pre-2 must flip enforcement in the same PR as the UI field; if the UI ships alone, new creations stay
  gender-optional.
- **R-3 resolved by finalization:** the draft was unjournaled; final migration 0198 now has generated snapshot and
  journal metadata. Canonical local and exact-head CI checks remain required before delivery.
- **R-4** Generated clients (admin, pos) change; root regenerates and reviews them.
- **R-5** The CHECK scan on `customers` under ACCESS EXCLUSIVE grows with the table; NOT VALID/VALIDATE is the
  mitigation if the table is large on staging/production.

## 13. Independent review receipt

Fresh Astra (`gpt-6-astra`, high), through T3 delegation, reviewed implementation `465093155572e31a44fb88a82595533c9e4a800d`
against `7159a9f0189a93cdb62828e7d9e78a1e1103a2ad` on 2026-11-01: no confirmed P0–P3 findings; database/security
accepted by static inspection. It ran no tests or database access. The reviewer explicitly distinguished the
old-operation compatibility tests from actually running a previous container image. Canonical migration proof
was pending at that review and is completed separately by the root. Rebase reconciliation moved the schema
registration and expected schema names into the files already extracted on main; it preserves the reviewed
customer schemas and all parallel owner-decision rows. Final 0198 SQL bytes equal the reviewed draft body.

Final local proof after rebase on `f5e88520`: canonical bootstrap applied journaled 0198 without draft injection;
five DB files passed 102 tests, eight selected API files passed 123 tests, contracts passed 1128 tests across 71
files, scoped typecheck passed (21 tasks), scoped API/contracts lint and module-map/cycle checks passed, both
generated-client checks passed, and a second `db:generate` reported no schema changes. The earlier full customer
scope passed 342 API tests, observability passed 110, and the unchanged reception UI passed 21; exact-head full
workspace checks remain CI's gate. Local backward compatibility proves the old SQL operations/request shape,
not an executed previous container image; actual deployment/rollback verification remains a release gate.
