# Data model — 038 duplicate-name warning

No schema change. The slice reads existing columns only.

## Employee (existing — `packages/db/schema/staff.ts`)

| Column | Use here |
|---|---|
| `company_id`, `business_id` | scope filter (DN-Q1 A: same business) |
| `id` | returned; `exclude_employee_id` removes the edited employee |
| `name_en` (required), `name_ar` (nullable) | compared field by field after the name key (DN-Q2, DN-Q3) |
| `primary_branch_id`, `role_code` | returned for visible matches (DN-Q5 A) |
| `deleted_at` | `IS NULL` only (DN-Q4 A); `contract_end` is ignored |

## EmployeeBranch (existing)

Open attachments (`"to" IS NULL`) decide visibility together with the primary branch, exactly as in
`list-employees.query.ts`.

## Name match (read projection)

| Field | Type | Notes |
|---|---|---|
| `matches[]` | ≤ 10 items `{ id, name_en, name_ar \| null, primary_branch_id, role_code }` | visible only; ordered by `name_en`, then `id` |
| `visible_total` | integer ≥ 0 | all visible matches, not capped |
| `hidden_count` | integer ≥ 0 | matches outside the caller's visible branches; no other data about them |

Matching rule: `key(name_en) = key(input.name_en)` OR (`name_ar IS NOT NULL` AND `input.name_ar` given AND
`key(name_ar) = key(input.name_ar)`).
