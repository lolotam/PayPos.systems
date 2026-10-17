# Spec 052 — Business identity settings: official name and logo (Phase 1 row 27h)

> **Status:** Draft · 2026-10-17 · docs-only PR. Owner answer ST-Q1 (batch 14) is recorded in
> [spec 051 owner-questions](../051-staff-employee-number/owner-questions.ar.md); BI-Q1…BI-Q4 (batch 28, Waleed's picks,
> 2026-10-17) are recorded in [owner-questions.ar.md](owner-questions.ar.md); no question is open. Abu Salem has not
> answered batch 28; if his pick differs, his pick binds and the rule changes in a follow-up (`CLAUDE.md` §1 5b).
> BI-Q1 (a new owner-only permission) and BI-Q3 (10 MiB, no logo-specific cap) differ from what the first draft assumed;
> §2, §3, §5.1, §5.3, §5.4 and §5.7 are rewritten accordingly.
> **Needed by:** row 27g (official attendance statement PDF), through 27i (PDF renderer).
> **Design advisors (CLAUDE.md §1, pipeline step 2):** Codex astra 6 medium and Claude Fable 5.1 medium, read-only,
> 2026-10-17. The slice uploads files, so both were required; their decisions are merged in §5.

## 1. What and why

Each business (the salon, the restaurant) has an **official identity** that the official attendance statement prints in its
header: a **logo** and the **official business name in Arabic and in English**. Today the system has neither: `businesses`
holds only a display name (`name_en` required, `name_ar` optional), and there is no place for a logo.

Owner answer **ST-Q1** (Waleed and Abu Salem, 2026-10-12, same pick): the owner uploads the logo once in the business
settings (PNG or JPG) and types the official name in Arabic and English; **with no logo, the statement shows the name
only**. Per business, not per company (a company may own several businesses with different brands).

**Worked example.** Company with two businesses. «لمسة جمال» (salon): official name ar «صالون لمسة جمال», en
"Lamsa Jamal Salon", logo uploaded. «Burger Hub» (restaurant): English name only, no logo. A statement for the salon in
Arabic shows logo + «صالون لمسة جمال»; in English, logo + "Lamsa Jamal Salon". A statement for the restaurant shows only
the name text.

## 2. Scope and split (max 3 subtasks per PR; one use case per PR)

| Part | Use case / content | Subtasks | Depends on |
|------|--------------------|----------|-----------|
| **27h-0** | This spec + ADR-0046 + owner questions (docs-only PR) | spec, ADR, plan row | — |
| **27h-1a** | permission `manage:business-identity:business` (BI-Q1) | (a) migration that inserts the permission and its owner role default (pattern of migration 0128), added to `ROLE_DEFAULTS`, `OWNER_GRANTED_PERMISSIONS` (db and identity lists), `deviceForbidden` in `packages/db/src/system-role-policy.ts` (a device is otherwise eligible for every catalog permission not listed there) and the owner-only rules of `permission-edit`; (b) the ar/en permission-name catalogs («إدارة هوية النشاط») in `packages/i18n`; (c) tests: default owner-only, only the owner can grant it, never a device (an ALLOW override on a device membership is refused), `privileges.spec.ts` allowlist | 27h-0 |
| **27h-1** | `update-business-identity-names` | (a) migration: 3 columns + CHECKs + composite FK + partial unique index, `privileges.spec.ts` check, RLS negative test; (b) contract + use case + audit + cache-guard fix; (c) integration + query-shape tests | 27h-1a |
| **27h-2** | files side (no new endpoint, no logo-specific size cap: BI-Q3 keeps the generic 10 MiB) | (a) `validateStoredPermission`: `settings` ⇒ `read:settings:business`; (b) `purge_started` added to the file facts read + tests | 27h-0 |
| **27h-3** | `retire-business-logo` (worker, `files`-owned consumer; ships **before** any producer) | (a) `BusinessLogoChanged` registered as a known event type with a database-only idempotent consumer, the module-map event arrow **and the reverse port arrow `files → settings` (logo-reference read)**; (b) lock, re-check through that port, `purge_started_at` handoff, the `retired` kind in the retention worker (storage delete outside transactions, tombstone, system audit) and the schedule bootstrap of §5.1 item 5; (c) race, crash-between-steps and replay tests with synthetic events | 27h-1 (needs `business_settings.logo_file_id` for the reference check), 27h-2 (needs the `purge_started` flag) |
| **27h-4** | `set-business-logo` (bind or remove; the event producer) | (a) domain `validateLogoFile` + port + adapter (`settings → files` read) + module-map line; (b) use case + `PUT /v1/businesses/:businessId/settings/logo` + audit + `BusinessLogoChanged` emit; (c) `readBusinessIdentity` + pure `statementIdentity` exports + tests | 27h-1, 27h-2, 27h-3 |
| **27h-5** | Admin screen (names, upload with status, preview, replace, remove) | (a) names form; (b) logo upload flow (files endpoints, poll status); (c) preview through the audited download + i18n | 27h-1, 27h-4 |

Row 27i's logo-bytes reader depends on 27h-4 (the schema, introduced in 27h-1, and the binding surface); plan row 27i lists `27, 27h-4` (also stated in the 27i row so 27i cannot start before the binding exists). Not here: the statement itself (27g), the PDF renderer (27i), the files-side bytes reader for the renderer (27i), the
`staff → settings` import arrow (27g's ADR). Other documents (receipts, invoices) may reuse the identity later; out of scope.

## 3. Owner rules (final)

**Final (from the owner answers and earlier owner decisions):**

- **BR-01 (ST-Q1):** one official identity **per business**, kept in the business settings.
- **BR-02 (ST-Q1):** the logo is a PNG or JPG image, uploaded once and replaceable.
- **BR-03 (ST-Q1):** the official name has an Arabic and an English form.
- **BR-04 (ST-Q1):** a business with no logo still gets a statement: the header shows the name only.
- **BR-05 (ST-Q4):** the statement language (ar or en) is chosen at download; the header name follows that language.
- **BR-06 (ADR-0022, owner 2026-10-03):** a verified file is kept until authorised deletion or **replacement**; so a
  replaced or removed logo's file is deleted (27h-3).
- **BR-07 (CLAUDE.md §8):** every change to settings is audited.

**Owner answers of batch 28 (Waleed's picks; Abu Salem has not answered, and his pick would replace them):**

- **BR-08 (BI-Q1):** only the owner may change the official names and the logo, through a **new permission «إدارة هوية النشاط»**
  (`manage:business-identity:business`, §5.4). The owner holds it by default and can grant it to any human role if she
  wants; never a device. It covers both the names and the logo (bind and remove).
- **BR-09 (BI-Q2):** the official name is a **separate field** from the business display name. When it is empty the
  statement uses the display name (§6).
- **BR-10 (BI-Q3):** the logo's maximum size is **10 MiB**, the limit every file already has. There is no logo-specific cap
  anywhere (no `request-upload` rule, no verification rule, no bind check for size).
- **BR-11 (BI-Q4):** both official names are optional. When one is missing the header takes, in order: the official name in the
  requested language, the official name in the other language, the display name in the requested language, the display
  name in the other language. The header is never empty and a business may write one language only.

## 4. User scenarios and acceptance criteria

| ID | Scenario |
|----|----------|
| BI-01 | The owner (or a person the owner granted the identity permission to) sets Arabic and English official names; they are saved trimmed and appear on the next read; one audit entry holds before and after. |
| BI-02 | A name longer than 255 characters, or blank after trimming, is refused with a bilingual validation error; nothing is saved or audited. |
| BI-03 | The owner uploads a PNG through the existing files flow (request, PUT, confirm, poll). When the file is READY, binding it saves `logo_file_id`. Binding a PENDING or VERIFYING file is refused with `FILE_NOT_READY`. |
| BI-04 | A PDF, XLSX, or any file that is not PNG/JPEG cannot be bound as a logo, even if it is READY and uploaded by the same user. |
| BI-05 | A file uploaded by someone else, for another business, for another owner module, by another company, or one whose purge has started **or completed** cannot be bound: all answer `FILE_NOT_FOUND`, identical to an unknown id. |
| BI-06 | Binding a new logo replaces the old one; an outbox event `BusinessLogoChanged` carries the previous and new ids; the old file is retired by the worker (27h-3), never inside the request. |
| BI-07 | Removing the logo (`file_id: null`) clears the reference, audits it, and emits the same event; the statement falls back to the name only. |
| BI-08 | Two concurrent binds of the same file, or of two files, leave exactly one reference and a continuous audit chain. |
| BI-09 | The same file cannot be the logo of two businesses (unique per company). |
| BI-10 | Through the settings API, a user from another company, or without the permission, can neither read nor change the identity; the response never discloses that the business exists. The attendance statement reads the identity server-side for its own authorised requester (§5.1 item 6), a separate authorization. |
| BI-11 | With storage not configured, names can still be saved; upload returns `STORAGE_NOT_CONFIGURED`; binding an already READY file still works (it reads the database only). |
| BI-12 | `readBusinessIdentity` returns the three stored fields; `statementIdentity(language, identity, displayNames)` returns the header name per §6 and whether a logo exists. |
| BI-13 | The settings read (`GET .../settings`) includes the three new fields; a Redis entry cached before this release is never served without them. |
| BI-14 | The audit and the event never contain a storage key, a signed URL or file bytes. |
| BI-15 | A person who holds `manage:settings:business` but not `manage:business-identity:business` (a manager) is refused `FORBIDDEN` on the names, the bind and the removal, and nothing is written; the owner, and a person the owner granted the permission to, succeed. A person without `manage:files:business` can still type names and bind a file she uploaded but cannot upload one. |
| BI-16 | A logo whose upload and whose re-encoded output are both within the generic 10 MiB limit is accepted like any file and can be bound; one whose re-encoding grows past the limit is rejected at verification with `FILE_SIZE_INVALID`, like any image. Nothing logo-specific refuses either. |

### Edge cases

- The bound file's object is purged or missing later: the row keeps its reference (the foreign key holds the tombstone);
  the reader reports "no usable logo" and the statement shows the name only; storage outages stay distinguishable from
  "no logo" so a transient failure is retried by the renderer, not printed as name-only.
- Rebinding the file that is already bound is a no-op (no audit, no event).
- A READY settings-owned file that is never bound stays as an orphan; sweeping such orphans is a deferred follow-up (issue
  to be opened at 27h-4), not a rule here.
- A closed company is refused like every settings write.

## 5. Slice design

### 5.1 Chosen design (merged from the two advisors)

1. **Storage.** Three nullable columns on the existing `business_settings` (one row per business, already locked, audited
   and cached): `official_name_ar`, `official_name_en`, `logo_file_id`. No new table (a second row, audit entity and
   cache entry for three columns). Both advisors agree.
2. **Upload.** Reuse the `files` pipeline unchanged: `POST businesses/:businessId/files/uploads` with
   `owner_module='settings'`, `owner_entity_id=<business id>`, `required_permission='read:settings:business'`, no branch;
   then confirm, worker verification (type from bytes, size, full sharp re-encode, metadata stripped), poll status. The
   files endpoints keep their own authority (`manage:files:business`, owner-only by default since 13b); the identity
   permission does not replace it (§5.4).
   Binding happens in a **separate settings call** that receives only the file id (ADR-0031 pattern): settings never
   handles bytes, keys, or storage.
3. **Bind check** inside the settings tenant transaction, after the business settings row lock, through the existing
   `files` read export (`documentFileFacts`, extended additively with `purge_started`): READY, purge neither started nor completed,
   `content_type` in PNG/JPEG, `owner_module='settings'`, `owner_entity_id` and `business_id` both equal the route's business id, no branch,
   `required_permission='read:settings:business'`, `created_by` = the actor. **Order matters, so that no answer discloses a
   file the caller may not know:** (a) first every ownership and identity check above (purge, `owner_module`,
   `owner_entity_id`, `business_id`, branch, `created_by`, `required_permission`, `content_type`); any mismatch answers
   `FILE_NOT_FOUND`, identical to an unknown id; (b) only then the status: PENDING/VERIFYING answers `FILE_NOT_READY`. There is no size check at the bind: a READY
   file already passed the generic 10 MiB policy (BI-Q3).
4. **No logo-specific cap (BI-Q3 = 10 MiB).** The generic file policy and the DB checks apply unchanged, and the
   verification worker re-encodes the logo like any image. `request-upload`, the verification worker and the bind add
   nothing for size, and the employee-document images are unaffected. No new pixel rule: sharp's existing
   16 M-pixel input cap bounds memory. Verification already validates the re-encoded bytes against the generic policy (`inspectContent`), so every READY logo is within 10 MiB; the renderer (27i) still bounds its read at that cap.
5. **Replace and remove.** The bind use case writes `BusinessLogoChanged { business_id, previous_file_id,
   file_id | null }` to the outbox in the same transaction. The **`files`-owned worker consumer** (27h-3, shipped before this producer so no event is ever emitted without a consumer) retires the
   previous file in **two durable steps**, because an outbox consumer runs inside one tenant transaction together with its
   dedupe write and may do database work only (ADR-0018). Step 1, the consumer (database only): take the same business
   lock that binding takes, **then** re-check, through a settings-owned port wired at the composition root (no `files → settings`
   import; the port is a declared arrow, §5.6) whose single operation takes the settings row lock and reports whether the file
   is still the logo, so `files` never queries a settings table itself, that the file is no longer referenced, **then** set `purge_started_at`
   (so a later bind of that file is refused); reference check and marker run under one lock, so a concurrent re-bind
   cannot slip between them. This commit is the durable handoff and is idempotent on replay. Step 2, the existing hourly retention worker
   (ADR-0022: bounded batches, recoverable leases, fencing) gains a third eligibility kind, `retired` (`purge_started_at`
   set, `purged_at` null, not bound), deletes the object outside any DB transaction and writes the tombstone and system
   audit. **The retired path deletes both objects:** the verified object at `storage_key` (a READY logo's bytes live there) and
   the `staging_key` object when it still exists (a crash between verification and staging cleanup can leave it; each
   deletion is idempotent, a missing object counts as deleted). The claim returns both keys for this kind, the tombstone and
   `purged_at` are written only after both deletions are acknowledged, and a test proves that neither object exists
   afterwards. A crash between the steps loses nothing: the next retention run picks the row up. **Schedule bootstrap:** the hourly
   retention schedules are registered per tenant only when a `FileUploadRequested` is delivered, so a tenant whose last
   such event predates 27h-3 would never run the `retired` kind. The schedule upsert cannot sit inside the consumer
   transaction (BullMQ is not the database), so it is a **replay-safe post-commit step of the same outbox delivery**
   (the ADR-0018 transport-publisher pattern: it runs outside `OutboxConsumer.handle`, after the claim commits, and the
   event is acknowledged only once the upsert has succeeded). If the worker crashes between the commit and the upsert, the
   event is delivered again; the consumer is idempotent through its dedupe record and `purge_started_at`, and the upsert
   (the registration `files.deliver` uses, keyed per company) is idempotent, so the replay completes the missing upsert.
   Nothing runs at worker start. **Storage disabled:** registering the
   consumer, the durable handoff (`purge_started_at`) and the schedules needs only the database and Redis, so 27h-3 makes
   them independent of object storage (today `startFilesWorker` returns `null` when storage is absent). The retention
   processor itself still registers, and when storage is unavailable it skips the run without claiming any row; the rows
   stay pending and the next hourly run after storage returns deletes them.
   Rejected: an in-transaction retire export (a cross-module write plus storage IO in a transaction), and keeping files
   forever (contradicts BR-06). Because 27h-3 merges first, the event type is known and handled before 27h-4 can emit it; no emitted event is parked or silently acknowledged.
6. **Seam for 27g/27i.** `settings/index.ts` exports `readBusinessIdentity(tx, companyId, businessId)` returning
   `{ official_name_ar, official_name_en, logo_file_id }` and the pure `statementIdentity` (§6). The **bytes** reader is
   declared, not built: a `files`-owned export that resolves the currently bound logo of the authorised statement's
   business (never an arbitrary id from the requester), reads at most the generic file cap (10 MiB, BI-Q3), and writes one `file_access_audit` ALLOW
   row for the requester. Built with 27i. This matters because the statement requester holds "view attendance"
   (`read:attendance:branch`), not necessarily any settings or files permission, so the stored `read:settings:business`
   gates only the admin preview, not the statement.
7. **Cache.** `businessSettingsQuery` extends its SELECT and changes its stale-entry guard from `'limit_bps' in value` to
   `'logo_file_id' in value`; otherwise old cached JSON is served without the new keys (BI-13).

### 5.2 Schema changes (27h-1)

| Table | Columns added | RLS | Indexes | Tenant-qualified FKs |
|-------|---------------|-----|---------|----------------------|
| `business_settings` | `official_name_ar text NULL`, `official_name_en text NULL`, `logo_file_id uuid NULL`; `CHECK (x IS NULL OR char_length(x) BETWEEN 1 AND 255)` on each name | unchanged: `ENABLE` + `FORCE ROW LEVEL SECURITY`, existing policy and grants (columns are additive; `privileges.spec.ts` checked) | partial `UNIQUE (company_id, logo_file_id) WHERE logo_file_id IS NOT NULL` (also serves the FK) | `(company_id, logo_file_id)` → `file_objects (company_id, id)`, `ON DELETE RESTRICT` |

Primary key stays `(company_id, business_id)` (ADR-0007). Additive, expand-only migration: no backfill, no default; null means
"not set". The negative isolation test adds: another company's `file_objects.id` cannot be referenced (FK) and cannot be
read through the bind path (RLS). The unique index is created `CONCURRENTLY` in its own migration file through the
recoverable runner of ADR-0033 (`CLAUDE.md` §5: indexes on existing tables are concurrent); the columns and the FK come in the
preceding migration.

### 5.3 API contract

Contracts in `packages/contracts` (Zod, strict, snake_case, listed in `openapi.ts`).

- `GET /v1/businesses/:businessId/settings` · `@Require('read:settings:business')` · response gains
  `official_name_ar: string|null`, `official_name_en: string|null`, `logo_file_id: string|null`.
- `PATCH /v1/businesses/:businessId/settings/identity` (27h-1) · `@Require('manage:business-identity:business')` · body
  `{ official_name_ar?: string|null, official_name_en?: string|null }`; an omitted key is left unchanged, `null` clears.
  Names are trimmed, 1..255 characters. 200 returns the two fields. No Idempotency-Key (configuration with audit, as spec 018).
- `PUT /v1/businesses/:businessId/settings/logo` (27h-4) · `@Require('manage:business-identity:business')` · body
  `{ file_id: uuid|null }`; `null` removes. 200 returns `{ logo_file_id }`. No Idempotency-Key (rebinding the current file
  is a no-op).
- Errors reuse the envelope `{ code, message_ar, message_en }`: `VALIDATION_FAILED`, `FORBIDDEN`, `FILE_NOT_READY`,
  `FILE_NOT_FOUND`, `NOT_READY`, `TRANSACTION_RETRY_REQUIRED`. New codes only if the existing ones do not fit.
- Preview of the logo in admin uses the existing audited `POST files/:id/download`.

### 5.4 Permissions (BI-Q1)

- Reading the settings (including the three new fields) keeps `read:settings:business`.
- Changing the names, binding the logo and removing it need the new `manage:business-identity:business` (BI-Q1, BR-08):
  `ROLE_DEFAULTS = ['owner']`, added to `OWNER_GRANTED_PERMISSIONS` (db and identity lists), `deviceForbidden` in `packages/db/src/system-role-policy.ts`, the owner-only rules of
  `permission-edit` and the i18n permission-name catalogs (ar «إدارة هوية النشاط»); the owner can grant it to any human role,
  never a device. A migration (27h-1a, pattern of 0128) inserts it into `permissions` and into the owner role default.
  `manage:settings:business` no longer lets anyone change the identity.
- Uploading the logo file keeps the files rule, unchanged: `manage:files:business`, owner-only by default since 13b
  (a delegate who should also upload needs both permissions from the owner). Every delegate also needs `read:settings:business`
  (held by the managers by default): it is the permission of `GET …/settings` and the stored permission of the logo upload
  (§5.1 item 2), which `request-upload` checks too, so a role without it cannot manage the identity until it is given.
  The bind still accepts only a file the actor
  uploaded herself (§5.1 item 3). Removal (`file_id: null`) needs the identity permission only. The 13b files rule is
  not changed by this slice.
- Live recheck of `manage:business-identity:business` inside the transaction after the settings row lock (the
  "revoked authority during the lock wait" test, §5.7).

### 5.5 Events and audit

- **Published:** `BusinessLogoChanged` (settings, `events/published.ts`, Arabic one-line doc): emitted in the same
  transaction as a bind/remove that changes the reference. Payload: ids only.
- **Consumed:** by the `files` worker consumer (27h-3). Delivery is at-least-once, so the consumer is idempotent.
- **Audit:** entity `business_settings`, action `settings.identity_changed`, before/after hold the three columns (names and
  file ids); never a storage key.

### 5.6 Module map and ADR

Two new arrows, both declared in `docs/module-map.md` by the PR that introduces them (ADR-0046, this PR, is the decision):
the event arrow `settings ⇒ files` (`BusinessLogoChanged`, consumed by the retire consumer) in 27h-3, and the read arrow
`settings → files` (`documentFileFacts`, mirroring ADR-0031's `staff → files`) in 27h-4. `files` imports only `tenancy`
today, so there is no cycle. The retire consumer's reference check is a **reverse read port arrow `files → settings`** (is this file still the business's logo), declared in `docs/module-map.md` in 27h-3 (table and YAML) beside the event arrow and wired at the composition root, so there is no compile-time import and no cycle. The later `staff → settings` arrow belongs to 27g.

### 5.7 Test plan

- **Domain unit:** `validateLogoFile` (every field of §5.1 item 3, one case each; no size case, BI-16 covers the limit); `statementIdentity` (every branch of
  §6); name normalisation.
- **Integration (real Postgres, one cloned DB per spec file):** BI-01…BI-16; the permission matrix of BI-15 (owner, granted person, manager with `manage:settings:business` only, device); two concurrent binds; bind while VERIFYING;
  purge-start versus bind race; event replay (27h-3); revoked authority during the lock wait.
- **RLS negative:** another company cannot read or write `business_settings` identity columns, nor reference its files;
  the FK rejects a cross-tenant file id.
- **Queries:** result-shape test and `EXPLAIN` index assertion for the extended settings read; the old-cache-entry test.
- **Contracts:** strict bodies, trimming, 255 limit, OpenAPI route and status, `pnpm contracts:openapi` fresh.
- **UI (27h-5):** upload, status polling, preview, replace, remove, ar/en messages, RTL logical properties.
- **Docs:** doc comments in Arabic on `domain/**`, `ports/**` and `events/published.ts` in the same commit.

## 6. Header-name fallback (pure `settings` domain; BI-Q2, BI-Q4)

`statementIdentity(language, identity, displayNames)` returns the header text, first match wins:

1. the official name in the requested language;
2. the official name in the other language;
3. the business display name in the requested language;
4. the business display name in the other language (`name_en` is always present).

The function is pure and lives in `settings/domain`; the display names reach it through a port that reads tenancy (an
existing arrow), not through `queries/` (queries may not import domain).

## 7. Success criteria

- SC-01: the owner sets the identity of a business in under two minutes without help.
- SC-02: no storage key, signed URL, or file bytes appears in any settings or identity response, audit row, event payload, or log line (BI-14). The `files` capability endpoints (upload and audited download) return presigned URLs by design and are outside this criterion.
- SC-03: a statement for a business without a logo or official name still prints a header (never blank).

## 8. Assumptions

- Storage (R2/S3) is configured in staging and production; local development without it still passes the names tests.
- The logo is shown only on the official statement for now; receipts and invoices (P2) may reuse it in their own rows.
- Image dimensions are not stored: the renderer scales the logo to a fixed height (27i).
- Retention of a READY logo that was never bound (an abandoned bind) is a deferred cleanup, not part of this slice.
