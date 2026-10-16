# Spec 052 — Business identity settings: official name and logo (Phase 1 row 27h)

> **Status:** Draft · 2026-10-17 · docs-only PR. Owner answer ST-Q1 (batch 14) is recorded in
> [spec 051 owner-questions](../051-staff-employee-number/owner-questions.ar.md); the remaining rules wait on BI-Q1…BI-Q4 in
> [owner-questions.ar.md](owner-questions.ar.md) (all `PENDING`). **No code starts before they are answered.**
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
| **27h-1** | `update-business-identity-names` | (a) migration: 3 columns + CHECKs + composite FK + partial unique index, `privileges.spec.ts` check, RLS negative test; (b) contract + use case + audit + cache-guard fix; (c) integration + query-shape tests | 27h-0 answered |
| **27h-2** | files side (no new endpoint) | (a) `validateStoredPermission`: `settings` ⇒ `read:settings:business`; (b) per-owner-module upload cap at `request-upload`; (c) `purge_started` added to the file facts read + tests | 27h-0 answered |
| **27h-3** | `set-business-logo` (bind or remove) | (a) domain `validateLogoFile` + port + adapter (`settings → files` read) + module-map line; (b) use case + `PUT /v1/businesses/:businessId/settings/logo` + audit + `BusinessLogoChanged` event; (c) `readBusinessIdentity` + pure `statementIdentity` exports + tests | 27h-1, 27h-2 |
| **27h-4** | `retire-business-logo` (worker, `files`-owned consumer) | (a) consumer of `BusinessLogoChanged`; (b) re-check + `purge_started_at` + storage delete + tombstone + system audit; (c) race tests | 27h-3 |
| **27h-5** | Admin screen (names, upload with status, preview, replace, remove) | (a) names form; (b) logo upload flow (files endpoints, poll status); (c) preview through the audited download + i18n | 27h-1, 27h-3 (4 before "replace" is enabled in production) |

Not here: the statement itself (27g), the PDF renderer (27i), the files-side bytes reader for the renderer (27i), the
`staff → settings` import arrow (27g's ADR). Other documents (receipts, invoices) may reuse the identity later; out of scope.

## 3. Owner rules (final) and pending

**Final (from the owner answers and earlier owner decisions):**

- **BR-01 (ST-Q1):** one official identity **per business**, kept in the business settings.
- **BR-02 (ST-Q1):** the logo is a PNG or JPG image, uploaded once and replaceable.
- **BR-03 (ST-Q1):** the official name has an Arabic and an English form.
- **BR-04 (ST-Q1):** a business with no logo still gets a statement: the header shows the name only.
- **BR-05 (ST-Q4):** the statement language (ar or en) is chosen at download; the header name follows that language.
- **BR-06 (ADR-0022, owner 2026-10-03):** a verified file is kept until authorised deletion or **replacement**; so a
  replaced or removed logo's file is deleted (27h-4).
- **BR-07 (CLAUDE.md §8):** every change to settings is audited.

**Pending (each is `PENDING` in [owner-questions.ar.md](owner-questions.ar.md); nothing below is implemented until answered):**

- **TODO(spec) BI-Q1** — who may change the identity (names, logo).
- **TODO(spec) BI-Q2** — is the official name a separate field from the business display name, and what the header
  shows when it is empty.
- **TODO(spec) BI-Q3** — the logo's maximum file size.
- **TODO(spec) BI-Q4** — may only one language of the official name be filled, and what the header shows then.

Until BI-Q2 and BI-Q4 are answered, the header-name fallback chain in §6 is a **recommendation, not a rule**.

## 4. User scenarios and acceptance criteria

| ID | Scenario |
|----|----------|
| BI-01 | The owner sets Arabic and English official names; they are saved trimmed and appear on the next read; one audit entry holds before and after. |
| BI-02 | A name longer than 255 characters, or blank after trimming, is refused with a bilingual validation error; nothing is saved or audited. |
| BI-03 | The owner uploads a PNG through the existing files flow (request, PUT, confirm, poll). When the file is READY, binding it saves `logo_file_id`. Binding a PENDING or VERIFYING file is refused with `FILE_NOT_READY`. |
| BI-04 | A PDF, XLSX, or any file that is not PNG/JPEG cannot be bound as a logo, even if it is READY and uploaded by the same user. |
| BI-05 | A file uploaded by someone else, for another business, for another owner module, by another company, or one whose purge has started cannot be bound: all answer `FILE_NOT_FOUND`, identical to an unknown id. |
| BI-06 | Binding a new logo replaces the old one; an outbox event `BusinessLogoChanged` carries the previous and new ids; the old file is retired by the worker (27h-4), never inside the request. |
| BI-07 | Removing the logo (`file_id: null`) clears the reference, audits it, and emits the same event; the statement falls back to the name only. |
| BI-08 | Two concurrent binds of the same file, or of two files, leave exactly one reference and a continuous audit chain. |
| BI-09 | The same file cannot be the logo of two businesses (unique per company). |
| BI-10 | A user from another company, or without the permission, can neither read nor change the identity; the response never discloses that the business exists. |
| BI-11 | With storage not configured, names can still be saved; upload returns `STORAGE_NOT_CONFIGURED`; binding an already READY file still works (it reads the database only). |
| BI-12 | `readBusinessIdentity` returns the three stored fields; `statementIdentity(language, identity, displayNames)` returns the header name per §6 and whether a logo exists. |
| BI-13 | The settings read (`GET .../settings`) includes the three new fields; a Redis entry cached before this release is never served without them. |
| BI-14 | The audit and the event never contain a storage key, a signed URL or file bytes. |

### Edge cases

- The bound file's object is purged or missing later: the row keeps its reference (the foreign key holds the tombstone);
  the reader reports "no usable logo" and the statement shows the name only; storage outages stay distinguishable from
  "no logo" so a transient failure is retried by the renderer, not printed as name-only.
- Rebinding the file that is already bound is a no-op (no audit, no event).
- A READY settings-owned file that is never bound stays as an orphan; sweeping such orphans is a deferred follow-up (issue
  to be opened at 27h-3), not a rule here.
- A closed company is refused like every settings write.

## 5. Slice design

### 5.1 Chosen design (merged from the two advisors)

1. **Storage.** Three nullable columns on the existing `business_settings` (one row per business, already locked, audited
   and cached): `official_name_ar`, `official_name_en`, `logo_file_id`. No new table (a second row, audit entity and
   cache entry for three columns). Both advisors agree.
2. **Upload.** Reuse the `files` pipeline unchanged: `POST businesses/:businessId/files/uploads` with
   `owner_module='settings'`, `owner_entity_id=<business id>`, `required_permission='read:settings:business'`, no branch;
   then confirm, worker verification (type from bytes, size, full sharp re-encode, metadata stripped), poll status.
   Binding happens in a **separate settings call** that receives only the file id (ADR-0031 pattern): settings never
   handles bytes, keys, or storage.
3. **Bind check** inside the settings tenant transaction, after the business settings row lock, through the existing
   `files` read export (`documentFileFacts`, extended additively with `purge_started`): READY, purge not started or done,
   `content_type` in PNG/JPEG, `owner_module='settings'`, owner entity = business = the route's business, no branch,
   `required_permission='read:settings:business'`, `created_by` = the actor, `size_bytes` within the logo cap (BI-Q3).
   PENDING/VERIFYING answers `FILE_NOT_READY`; every other mismatch answers `FILE_NOT_FOUND`.
4. **Logo cap** is enforced twice: at `request-upload` by `owner_module` (so a too-large PUT is never issued) and at bind
   against the stored (post re-encode) size. The generic 10 MiB policy and the employee-document images are unchanged.
   No new pixel rule: sharp's existing 16 M-pixel input cap bounds memory.
5. **Replace and remove.** The bind use case writes `BusinessLogoChanged { business_id, previous_file_id,
   file_id | null }` to the outbox in the same transaction. A later **`files`-owned worker consumer** (27h-4) retires the
   previous file: it re-checks, through a port wired at the composition root (no `files → settings` import), that the file
   is no longer referenced, sets `purge_started_at` under the same business lock that binding takes (so a later bind of
   that file is refused), then deletes the object outside any DB transaction and writes the tombstone and system audit.
   Rejected: an in-transaction retire export (a cross-module write plus storage IO in a transaction), and keeping files
   forever (contradicts BR-06). Replacement stays disabled in production until 27h-4 has shipped.
6. **Seam for 27g/27i.** `settings/index.ts` exports `readBusinessIdentity(tx, companyId, businessId)` returning
   `{ official_name_ar, official_name_en, logo_file_id }` and the pure `statementIdentity` (§6). The **bytes** reader is
   declared, not built: a `files`-owned export that resolves the currently bound logo of the authorised statement's
   business (never an arbitrary id from the requester), reads at most the cap, and writes one `file_access_audit` ALLOW
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
read through the bind path (RLS). Index only needed in the same migration; no `CONCURRENTLY` (new column on a small table
per ADR-0033, confirm in the plan).

### 5.3 API contract

Contracts in `packages/contracts` (Zod, strict, snake_case, listed in `openapi.ts`).

- `GET /v1/businesses/:businessId/settings` · `@Require('read:settings:business')` · response gains
  `official_name_ar: string|null`, `official_name_en: string|null`, `logo_file_id: string|null`.
- `PATCH /v1/businesses/:businessId/settings/identity` (27h-1) · `@Require('manage:settings:business')` · body
  `{ official_name_ar?: string|null, official_name_en?: string|null }`; an omitted key is left unchanged, `null` clears.
  Names are trimmed, 1..255 characters. 200 returns the two fields. No Idempotency-Key (configuration with audit, as spec 018).
- `PUT /v1/businesses/:businessId/settings/logo` (27h-3) · `@Require('manage:settings:business')` · body
  `{ file_id: uuid|null }`; `null` removes. 200 returns `{ logo_file_id }`. No Idempotency-Key (rebinding the current file
  is a no-op).
- Errors reuse the envelope `{ code, message_ar, message_en }`: `VALIDATION_FAILED`, `FORBIDDEN`, `FILE_NOT_READY`,
  `FILE_NOT_FOUND`, `NOT_READY`, `TRANSACTION_RETRY_REQUIRED`. New codes only if the existing ones do not fit.
- Preview of the logo in admin uses the existing audited `POST files/:id/download`.

### 5.4 Permissions (BI-Q1 pending)

Recommended: names and bind use the existing `manage:settings:business`; reading uses `read:settings:business`. Uploading
the logo needs `manage:files:business` as today, which is **owner-only by default since 13b**, so by default only the
owner can upload; a manager with settings can type names but not upload, and can remove or rebind only a file they
uploaded themselves. The owner can grant `manage:files:business`. No new permission, no role-default migration. The
actual choice is BI-Q1; options that need a new permission or a files rule change will get their own plan.

### 5.5 Events and audit

- **Published:** `BusinessLogoChanged` (settings, `events/published.ts`, Arabic one-line doc): emitted in the same
  transaction as a bind/remove that changes the reference. Payload: ids only.
- **Consumed:** by the `files` worker consumer (27h-4). Delivery is at-least-once, so the consumer is idempotent.
- **Audit:** entity `business_settings`, action `settings.identity_changed`, before/after hold the three columns (names and
  file ids); never a storage key.

### 5.6 Module map and ADR

`settings → files` (read, `documentFileFacts`) is a new import arrow: ADR-0046 (this PR) and a `docs/module-map.md` line
in 27h-3, mirroring ADR-0031's `staff → files`. `files` imports only `tenancy` today, so there is no cycle. The retire
consumer's reference check is a port, not an import. The later `staff → settings` arrow belongs to 27g.

### 5.7 Test plan

- **Domain unit:** `validateLogoFile` (every field of §5.1 item 3, one case each); `statementIdentity` (every branch of
  §6); name normalisation.
- **Integration (real Postgres, one cloned DB per spec file):** BI-01…BI-14; two concurrent binds; bind while VERIFYING;
  purge-start versus bind race; event replay (27h-4); revoked authority during the lock wait.
- **RLS negative:** another company cannot read or write `business_settings` identity columns, nor reference its files;
  the FK rejects a cross-tenant file id.
- **Queries:** result-shape test and `EXPLAIN` index assertion for the extended settings read; the old-cache-entry test.
- **Contracts:** strict bodies, trimming, 255 limit, OpenAPI route and status, `pnpm contracts:openapi` fresh.
- **UI (27h-5):** upload, status polling, preview, replace, remove, ar/en messages, RTL logical properties.
- **Docs:** doc comments in Arabic on `domain/**`, `ports/**` and `events/published.ts` in the same commit.

## 6. Header-name fallback (pure `settings` domain; recommendation pending BI-Q2, BI-Q4)

`statementIdentity(language, identity, displayNames)` returns the header text, first match wins:

1. the official name in the requested language;
2. the official name in the other language;
3. the business display name in the requested language;
4. the business display name in the other language (`name_en` is always present).

The function is pure and lives in `settings/domain`; the display names reach it through a port that reads tenancy (an
existing arrow), not through `queries/` (queries may not import domain).

## 7. Success criteria

- SC-01: the owner sets the identity of a business in under two minutes without help.
- SC-02: no storage key, URL, or file bytes appears in any audit row, event payload, log line, or API response (BI-14).
- SC-03: a statement for a business without a logo or official name still prints a header (never blank).

## 8. Assumptions

- Storage (R2/S3) is configured in staging and production; local development without it still passes the names tests.
- The logo is shown only on the official statement for now; receipts and invoices (P2) may reuse it in their own rows.
- Image dimensions are not stored: the renderer scales the logo to a fixed height (27i).
- Retention of a READY logo that was never bound (an abandoned bind) is a deferred cleanup, not part of this slice.
