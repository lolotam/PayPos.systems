# API contract — 040 employee IBAN

Base: `/v1/businesses/{businessId}/employees/{employeeId}/iban` · header `x-company-id` · `@Authenticated()` +
`SelectedCompanyGuard` on every method · access evaluated inside the transaction (see spec) · feature `staff`.

## GET …/iban → 200 `EmployeeIbanView`

```text
status: 'SET' | 'NOT_SET'
iban_last4: string(4) | null      null when NOT_SET
iban: string | null               full; only when can_read_full
bank_id: string | null            only when can_read_full
holder_name_en: string | null     only when can_read_full
revision: int >= 0                0 = never set
set_at: ISO instant | null
set_by: uuid | null               only when can_read_full
can_read_full: boolean
can_manage: boolean
```

404 `NOT_FOUND` when the caller has neither full read nor `manage:employees:business`, or the employee is unknown,
foreign or deleted.

## GET …/iban/history?cursor=<int>&limit=<1..100, default 20> → 200 `EmployeeIbanHistoryPage`

```text
items: [{ revision, iban | null, bank_id | null, holder_name_en | null, cleared, set_at, set_by, reason }]
next_cursor: int | null           next page: revision < cursor
```

Full-read holders only; everyone else 404.

## PUT …/iban → 200 `EmployeeIbanView`

Body (strict): `{ iban: string<=64 | null, bank_id: string<=48 | null, holder_name_en: string<=200 | null,
reason: string trim 1..500, expected_revision: int >= 0 }` — the three nullable fields are all null (clear) or all
strings. No `Idempotency-Key`.

| Code | HTTP | When |
|---|---|---|
| IBAN_FORMAT_INVALID | 400 | characters, length or BBAN shape |
| IBAN_COUNTRY_NOT_ALLOWED | 400 | not KW / SA / AE / BH / QA / OM |
| IBAN_CHECKSUM_INVALID | 400 | mod 97 ≠ 1 |
| IBAN_BANK_INVALID | 400 | unknown bank, other country, or known code ≠ IBAN code |
| IBAN_HOLDER_NAME_INVALID | 400 | empty, over 100, non-Latin |
| VALIDATION_FAILED | 400 | shape or reason |
| EMPLOYEE_IBAN_ALREADY_USED | 409 | current IBAN of another non-deleted employee of the company (no identity returned) |
| EMPLOYEE_IBAN_REVISION_CONFLICT | 409 | `expected_revision` ≠ current revision |
| NOT_FOUND | 404 | no manage access, unknown, foreign or deleted |
| FEATURE_DISABLED | as existing | `staff` feature off (after access) |
| TRANSACTION_RETRY_REQUIRED | as existing | serialization or lock timeout (as salary) |
