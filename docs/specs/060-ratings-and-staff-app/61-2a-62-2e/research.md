# Research: 61-2a + 62-2e — source evidence and decisions

Everything in §1 was read from `origin/main` at `cf70114e2cbe9efcb2b5dc4d327f2c82f87d54b3` with `git show` /
`git grep`. The planning checkout was 224 commits behind that pin, so no fact here comes from the working tree.
§2 lists what was **not** verified. §3 lists the decisions.

## 1. Verified facts

### 1.1 Prior work on main

| Claim | Evidence |
|---|---|
| 61-1b is merged | commit `336c5ea77`, «feat(identity): refuse ratings read grant to ineligible roles (61-1b) (#1135)» |
| 62-2d is merged | commit `27514f85d`, «feat(staff): 62-2d exception and document bells follow the alert rules (#562)» |
| `plan-61.md` is merged | commit `f4606d24f` (#1127); §6 «61-2a», decisions T5, T6, T8, T10 |
| **61-1a is not merged** | `git log --grep` finds only #1127 and #1135 for row 61; `docs/adr/` has no match for `OwnRatings` or `rating-summary`; `docs/module-map.md` lines 404–408 still say «Planned E» |
| Migration journal tail | `0235_2026-11-21_commission-sales-rls` (`idx` 235); `meta/0235_snapshot.json` is 30,797 lines / 934,925 bytes |

### 1.2 61-2a

| Fact | Where |
|---|---|
| No rating-summary code exists | `git grep` for `rating-summary`, `OwnRatingsAccess`, `readOwnRatingsAccess` under `apps/`, `packages/`: no match |
| `read:ratings:own` is seeded for every human role | `packages/db/migrations/0210_2026-11-05_staff-own-read-defaults.sql`; ADR-0027 addendum 2026-11-05 |
| The personal purpose permits four own reads, `read:ratings:own` among them, and «does not enable an endpoint before its own API slice lands» | `docs/adr/0027-personal-staff-session.md`, «Addendum 2026-11-05» |
| The both-paths route policy (`STAFF_ROUTE = 'staff'` + `PERSONAL_ROUTE = 'staff'` + private-view window) is written for spec 060 FR-A06b, which names FR-A01…FR-A04 only; FR-A05 (the rating summary) is not in that list | same ADR, paragraph before the addendum; spec 060 FR-A06b |
| A personal-session-only read exists | `apps/api/src/modules/staff/http/my-schedule.controller.ts`: `@Get() @Authenticated() @SetMetadata(PERSONAL_ROUTE, true)` |
| The reference implementation of an own read | `apps/api/src/modules/orders/http/own-work.controller.ts` (`GET /v1/staff/me/tips`), `queries/own-work-context.ts`, `queries/own-tips.query.ts`, `persistence/own-work-context.adapter.ts` |
| Its order of checks: session → (device) private-view window → `NOT_READY` → in one `withTenant`: live authority (403) → subject keys in the query (403) → query validation → column gate (`HIDDEN`) → data | same files; OpenAPI text in `packages/contracts/src/orders/own-tips-openapi.ts` |
| Own-employee reader | `apps/api/src/modules/staff/persistence/own-employee.ts` `readOwnEmployee`, exported from `staff/index.ts` |
| Own-access reader pattern | `apps/api/src/modules/identity/persistence/own-service-sessions-access.ts` (membership + feature `orders` + `evaluateAccess(... 'read:service-sessions:own' ...)`) |
| Business timezone reader | `apps/api/src/modules/tenancy/queries/active-business-time-zone.query.ts` `activeBusinessTimeZone(tx, companyId, businessId, branchId)` returns `businesses.timezone` for an active branch |
| Customers already has a `StaffColumnsPort` and adapter, unused by any route | `apps/api/src/modules/customers/ports/staff-columns.port.ts`, `persistence/staff-columns.adapter.ts`; not referenced in `customers.module.ts` |
| `rating_average` is stripped by settings until 61-3 | `apps/api/src/modules/settings/domain/staff-columns.ts` (`POSTPONED_COLUMNS`), per `plan-61.md` §1 |
| Attribution producer exists | `apps/api/src/modules/customers/persistence/drizzle-rating-submission-transactions.ts` inserts `rating_attributions` in the rating transaction (60-1, #738) |
| Table and index | `packages/db/schema/ratings-attributions.ts`: `company_id, id, rating_id, request_id, employee_id, business_id, branch_id, stars smallint, submitted_at timestamptz`; index `rating_attributions_employee_idx (company_id, employee_id, submitted_at)` from migration 0185 |
| Module-map arrows | `docs/module-map.yaml`: `customers: [tenancy, settings, staff, identity]` — every arrow 61-2a needs is declared |
| Module-map `reads` rule | `docs/module-map.md` §6 comment: a read port's adapter calling another module's exported read «is added under reads, one line per symbol, in the PR that introduces it» |
| The tips test injects the allowed columns through the reads token | `apps/api/src/modules/orders/__tests__/own-work-http.spec.ts` (`f.h.app.get<OwnWorkReads>(OWN_WORK_READS)`) |
| Feature for ratings | spec 060 error list: «`FEATURE_DISABLED` (feature `customers`)»; the flag is used in code by `@RequiresFeature('customers')` in `customers.controller.ts` and `customer-profile.controller.ts`; `identity/persistence/feature-reader.ts` `readFeatureEnabled(tx, companyId, flag, decisionAt?)` takes any flag string |
| `reads` lines are matched per file | `scripts/module-map/module-map.mjs` parses `{ from, to, symbol, file }`; `orders -> tenancy.activeBusinessTimeZone` is listed three times, once per adapter file |

### 1.3 62-2e

| Fact | Where |
|---|---|
| There is **no** document edit route | `apps/api/src/modules/staff/http/employee-documents.controller.ts`: only `GET` (list) and `POST` (record). Spec 028 defines `PATCH` for document **types** only |
| «Replace» in the admin is a new record of the same type | `apps/admin/src/staff/ui/employee-document-columns.tsx` (`onReplace(type_code)`), same form `employee-document-form.tsx` |
| Record contract today | `packages/contracts/src/staff/employee-documents.ts`: `recordEmployeeDocumentInput = strictObject({ type_code, file_id, expires_on })`; the form schema maps `''` → `null` for `expires_on` in `apps/admin/src/staff/api/use-employee-documents.ts` |
| Optional-text convention | same file: `name_ar: nameAr.nullable().optional()` with `nameAr = z.string().trim().min(1).max(255)` (`packages/contracts/src/bilingual/names.ts`); `leave.ts`: `note: z.string().trim().min(1).max(500).optional()` |
| Validation errors never echo values | `apps/api/src/shared/zod-validation.pipe.ts`: «issue paths and codes only — never the rejected values» |
| A failed `INSERT` cannot put its parameters in a log or a response | `staff/persistence/document-failures.ts` wraps an unknown database error as `new Error('DOCUMENT_PERSISTENCE_FAILED', { cause })`; `apps/api/src/shared/exception.filter.ts` logs `{ err }` and answers `INTERNAL_ERROR`; `packages/observability/src/serializers.ts` `errorDiagnostic` prints only a known error type and a known code — «The message, the causes, the stack and every other property are never printed» |
| The record response is stored | `packages/db/src/idempotency.ts` writes `response_body` as jsonb; `drizzle-employee-documents.ts` runs the use case inside `runIdempotent` and returns `documentView(...)` |
| Audit and event are built from the record | `drizzle-employee-documents.ts`: `snapshot(d)` for `appendAuditLog`, an explicit payload for `EmployeeDocumentRecorded` |
| Grants | migration 0074: `GRANT SELECT, INSERT ON employee_documents TO pospay_app; GRANT UPDATE(replaced_at) …`; `packages/db/test/document-grants.ts`, `table-grants.ts` |
| Read access | `apps/api/src/modules/identity/persistence/document-access.ts` `readDocumentAccess` → `read` = `read:files:business` at the business, `featureEnabled` = feature `staff`; used through `EmployeeDocumentReadAccess` in `staff/queries/employee-documents.query.ts` |
| The list returns `NOT_FOUND` when the caller cannot read | `employee-documents.controller.ts` (`result === null` → `NOT_FOUND`) |
| The bell carries only the id | `packages/contracts/src/staff-alert-notifications.ts` `documentExpiringParameters`: six parameters, the last `document_id`; `packages/notifications/src/templates/document-expiring.ts` (`textKind: 'id'`, revision 1) |
| The admin renderer drops the id from the text | `apps/admin/src/notifications/model/render-notification.ts` `staffAlertValues` |
| Bell text is asserted | `packages/i18n/src/__tests__/staff-alert-bells-catalog.spec.ts` fixes `inApp.document_expiring` in both locales |
| Inbox item shape | `packages/contracts/src/in-app-notifications.ts`: `business_id: id.nullable()`; `apps/api/src/modules/notifications/queries/in-app-notifications.query.ts` selects `business_id` |
| Notifications may not import staff | `docs/module-map.yaml`: `notifications: []` |
| Worker recipients are already filtered by `read:files:business` | `apps/worker/src/modules/staff/domain/document-expiry-notice.ts` `documentExpiryRecipients` |
| Plain-text PII precedent | `packages/db/schema/staff-ibans.ts`: `iban: text('iban')` |
| «New nullable column + CHECK» precedent | `0194_2026-11-01_service-duration-category.sql` (`SET LOCAL lock_timeout = '5s'`, `ADD COLUMN`, `ADD CONSTRAINT … NOT VALID`) then `0195_…` (`VALIDATE CONSTRAINT` in its own transaction); control-character CHECK wording in `0198_2026-11-01_customer-fields.sql` |

## 2. Not verified — the implementer checks first

1. Whether the stored `document_expiring` in-app row always has a non-null `business_id`. The worker handler writes
   `scope.business_id ?? null`; the expiry facts carry `business_id`, but the call that passes the scope was not read
   to the end. The design tolerates `null` (no lookup, today's text), so this changes one test fixture at most.
2. The repo's convention for a list of ids in a **query string** (the precedents found are JSON bodies). §3 D-11.
3. HTTP status of `VALIDATION_FAILED` and `FEATURE_DISABLED` in `apps/api/src/shared/errors.ts` (the own-tips OpenAPI
   says 400 for `VALIDATION_FAILED`).
4. What `SessionGuard` answers on a `PERSONAL_ROUTE = true` route for an admin cookie and for a reception-device
   operator session (expected 401; the test asserts the real value).
5. Exact line counts after formatting; `use-employee-documents.ts` is already 344 lines (limit 400).
6. Whether drizzle-kit emits the `NOT VALID` suffix or it is added by hand as in 0194 (the 0194 file is the model).
7. Whether `pnpm module-map:check` fails on a `reads` line whose adapter file does not exist yet. The plan avoids
   the question by adding the lines in the same commit as the adapter.

## 3. Decisions

| # | Decision | Rationale | Alternatives considered |
|---|---|---|---|
| D-1 | The 61-2a ports are documented **in this PR**: four `reads` lines (one per symbol for the new adapter file) and two port rows in `docs/module-map.md`, the regenerated `docs/module-map.yaml`, and one dated ADR-0010 addendum limited to these ports | `plan-61.md` §2.4 says these rows need the 61-1a addendum, its §4 table gives 61-2a no dependency, and 61-1a is not merged. No new arrow is added. The module-map rule puts a `reads` line in the PR that introduces the adapter | Wait for 61-1a (blocks a row the plan says is unblocked); ship without the addendum (leaves a declared-but-undocumented port) |
| D-2 | Route policy = **personal staff session only** (`PERSONAL_ROUTE = true`) | The delivery brief and `plan-61.md` §6 both say «on the personal staff session»; FR-A06b's both-paths policy lists FR-A01…FR-A04, not FR-A05; the narrower surface is the safe default while no screen uses the route | The own-tips policy (personal session, or the reception device behind the private-view window). It is what «شغلي» uses (D-A13) and 61-3 may need it for the card; switching later is three decorators, the tips controller's session line and one test (gate G-5) |
| D-3 | Authority is checked before the column gate | Same order as tips; an unauthorized caller cannot learn the column setting | Column first |
| D-4 | `readOwnRatingsAccess` gates on feature `customers`, and a disabled feature is answered 403 `FORBIDDEN` | Spec 060 names the flag for ratings; the own-access reader returns «no access» for a disabled feature, exactly as `readOwnServiceSessionsAccess` does for `orders`, so the caller cannot tell the cases apart | `@RequiresFeature('customers')` answering `FEATURE_DISABLED` (spec 060's error list names that code; not verified to run on the personal-session path) |
| D-5 | Month bounds are computed in SQL from the one sampled `now` and the business timezone, and compared to the bare `submitted_at` column | Keeps the index usable and has one source of «now» | Wrapping the column in `AT TIME ZONE` (defeats the index); JS-computed UTC bounds (DST arithmetic in TypeScript) |
| D-6 | Rounding: `round(avg(stars), 1)` on `numeric`, cast to text | PostgreSQL rounds `numeric` half away from zero, which is half up for positive values; `queries/` may not import `domain/` (`plan-61.md` T6) | Rounding in TypeScript (float) |
| D-7 | The number is recorded on record/replace only; no edit route | No edit route exists; the role cannot `UPDATE` the column; an in-place edit is a product question (DN-Q1) | Add a `PATCH` now (new write, new grant, new audit shape — not specified by any owner answer) |
| D-8 | The number never becomes a field of `EmployeeDocumentRecord`; it reaches `save` as a separate argument | The audit snapshot and the event payload are built from the record, so they cannot leak the number by construction | Add the field and remember to strip it in two places |
| D-9 | The `POST` response does not carry the number | That body is persisted in `idempotency_keys.response_body`; the admin refetches the list after a record | Return it (a second at-rest copy outside the permission-checked read) |
| D-10 | The bell gets the number from a new staff read keyed by document ids, called by the admin when the panel is open | `notifications` has no import arrow; the template already ships `document_id`; the inbox item has `business_id` | Enrich the inbox query (new arrow + ADR); store the number in `safe_parameters` (forbidden by AL-Q8) |
| D-11 | Lookup input: `ids` = 1–20 distinct UUIDs, comma-separated in the query string | One request per business per panel open; ids are not sensitive (already in `safe_parameters`) | `POST` with a JSON body (a read behind a write verb); one request per bell (N+1) |
| D-12 | The lookup returns only **current** documents of **non-deleted** employees that **have** a number | It mirrors what the existing list already shows an authorized reader; nothing new becomes readable | Also return replaced documents' numbers |
| D-13 | No-permission answer = 404 `NOT_FOUND`, decided before any document row is read | Same as the list; identical for every id set | 200 with an empty list (also safe, but differs from the list's contract) |
| D-14 | A second i18n key `inApp.document_expiring_numbered`; the existing key and template revision 1 stay untouched | The catalog spec pins today's text; stored rows are never re-interpreted | New template revision (changes stored-row semantics for no gain) |
| D-15 | Two migration files, mirroring 0194/0195: add column + `NOT VALID` CHECK, then `VALIDATE` | Established precedent for a CHECK on an existing table | One file (validates under the `ADD COLUMN` lock) |
| D-16 | The whole bundle runs as **Heavy** | Migration, permission-gated personal identifier, staff-session route (PP-195 §4) | Medium for 61-2a alone — not applicable to one PR |
