# Data model — 040 employee IBAN

## employee_ibans (new, append-only)

| Column | Type | Rule |
|---|---|---|
| company_id | uuid NOT NULL → companies(id) | tenant key; RLS predicate |
| id | uuid NOT NULL | UUID v7 from `IdGenerator`; PK `(company_id, id)` |
| business_id | uuid NOT NULL | the employee's business |
| employee_id | uuid NOT NULL | FK `(company_id, business_id, employee_id)` → employees `(company_id, business_id, id)` |
| revision | integer NOT NULL | > 0; UNIQUE `(company_id, employee_id, revision)` |
| iban | text NULL | normalised; per-country shape CHECK; NULL = cleared |
| bank_id | text NULL | reference id `<cc>-<slug>`; its prefix = the IBAN country (lower case) |
| holder_name_en | text NULL | 1–100 after trim |
| set_by | uuid NOT NULL → user(id) | actor |
| reason | text NOT NULL | 1–500 after trim |
| created_at | timestamptz NOT NULL default now() | shown as "set at" |

CHECK: `iban`, `bank_id`, `holder_name_en` all NULL or all NOT NULL.
Indexes: PK; unique (company_id, employee_id, revision); (company_id, business_id); (set_by);
(company_id, iban) WHERE iban IS NOT NULL.
RLS: ENABLE + FORCE; `FOR SELECT USING` / `FOR INSERT WITH CHECK` `company_id = app_company_id()` to `pospay_app`.
Grants: `SELECT, INSERT` to `pospay_app`; no UPDATE, no DELETE.

**Current entry** = the row with the highest `revision` for the employee. States: NOT_SET (no row, or the latest row
is a clearing) and SET (the latest row has an IBAN). Set, replace and clear each insert a new row; a no-op inserts
nothing.

## GCC bank (reference data, `packages/domain/src/gcc-banks.ts`)

`{ id: 'kw-nbk', country: 'KW', ibanBankCode: 'NBOK' | null, nameEn, nameAr }` — ids unique, prefixed by the
lower-case country; `ibanBankCode` matches the country's code shape when present; one `<cc>-other` per country.

## Audit (`audit_log`, existing)

`entity 'employee_iban'`, `entity_id` = the new entry id, `action 'iban.set' | 'iban.cleared'`, before/after
`{ entry_id, revision, iban_last4, bank_id, cleared }`, with no reason, full IBAN or holder name; the reason lives only in the protected history row.
