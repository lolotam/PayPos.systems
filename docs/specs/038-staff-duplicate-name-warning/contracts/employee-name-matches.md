# Contract — `POST /v1/businesses/{businessId}/employees/name-matches`

Read-only (TD-1). Zod source of truth: `packages/contracts/src/staff/employee-name-matches.ts`.

**Headers**: `x-company-id` (selected company), session cookie. No `Idempotency-Key`.

**Guards**: `@Authenticated()` + `SelectedCompanyGuard`; inside `withTenant`: `EmployeeDetailAccess.listScope` for
`manage:employees:business` and the staff feature.

## Request — `EmployeeNameMatchesInput` (strict)

```json
{ "name_en": "Sara Ahmed", "name_ar": "سارة أحمد", "exclude_employee_id": "0192…" }
```

| Field | Schema |
|---|---|
| `name_en` | `nameEn` (trimmed, 1–255) — required |
| `name_ar` | `nameAr.nullable().optional()` |
| `exclude_employee_id` | `employeeInputId.optional()` (lower-cased UUID) |

## Response 200 — `EmployeeNameMatches`

```json
{
  "matches": [
    { "id": "0192…", "name_en": "Sara Ahmed", "name_ar": "سارة أحمد", "primary_branch_id": "0192…", "role_code": "staff" }
  ],
  "visible_total": 1,
  "hidden_exists": false
}
```

## Errors

| Code | When |
|---|---|
| `VALIDATION_FAILED` (400) | body or path fails the schema |
| `FORBIDDEN` (403) | no company membership, or no branch where the caller holds `manage:employees:business` |
| `FEATURE_DISABLED` | staff feature off |
| `NOT_READY` | database/access providers not wired |

Unchanged: `POST /v1/businesses/{businessId}/employees`, `PATCH /v1/businesses/{businessId}/employees/{employeeId}`.
