# Research — 038 duplicate-name warning

## R1. Where the warning is produced

- **Decision**: a read-only `queries/` endpoint called by the admin form before submit.
- **Rationale**: reads go through `queries/` (`CLAUDE.md` §6); the owner rule is "never a block", so the server has
  nothing to enforce; the write path and its audits stay untouched; one PR does not touch two use cases.
- **Alternatives**: a `warnings[]` field on the create/update response (rejected: the record is already saved, "edit
  name" would cost a second update and audit row); a `force` flag on the writes (rejected: changes two audited use
  cases for an advisory rule).

## R2. Transport

- **Decision**: `POST /v1/businesses/{businessId}/employees/name-matches`, JSON body, 200, no side effect (TD-1).
- **Rationale**: names are personal data; a query string lands in URLs that the shared Traefik access log can record.
  The API's own pino serializer logs only the route template, but the proxy is outside our control.
- **Alternatives**: `GET ...?name_en=&name_ar=` (rejected for the reason above).

## R3. Name key (DN-Q3 A)

- **Decision**: one SQL expression applied to both sides:
  `btrim(regexp_replace(lower(translate(regexp_replace(normalize(x, NFKC), '[ًٌٍَُِّْٰـ]', '', 'g'), 'أإآٱةى', 'ااااهي')), '\s+', ' ', 'g'))`
  (diacritics U+064B–U+0652, superscript alef U+0670, tatweel U+0640). The typed values pass through the same
  expression as bound parameters, so there is only one definition.
- **Rationale**: `queries/` may not import `domain/`; computing the key in SQL for both sides avoids two
  implementations drifting. PostgreSQL 16 provides `normalize(text, NFKC)` on a UTF-8 database.
- **Alternatives**: a TypeScript key function compared against a stored generated column (rejected: needs a migration
  and a second implementation in SQL for the column); an expression index (not needed at salon scale — R5).

## R4. Visibility (DN-Q5 A)

- **Decision**: reuse `EmployeeDetailAccess.listScope` (already used by `list-employees.query.ts`). A match is
  "visible" when its primary branch and every open attachment are in `allowedBranchIds`; otherwise it only counts in
  `hidden_count`. No allowed branch → `FORBIDDEN`; feature off → `FEATURE_DISABLED`.
- **Rationale**: identical visibility rule to the employee list, so the warning never shows a record the list hides.

## R5. Index

- **Decision**: no new index. The filter `company_id = $1 AND business_id = $2 AND deleted_at IS NULL` uses
  `employees_company_business_id_idx`; the key is computed per row of one business.
- **Rationale**: a business holds tens to hundreds of employees. The EXPLAIN test asserts the index is used.

## R6. Admin flow

- **Decision**: a small hook wraps each form's `onSave`: on submit it calls the check (create always; update only if
  a trimmed name differs from the loaded record), holds the terms while the warning is open, and saves directly when
  there is no match or the check throws.
- **Rationale**: keeps both forms' existing `onSave` contract; one place for the gate logic; failure is fail-open.
