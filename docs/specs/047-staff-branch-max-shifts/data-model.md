# Data model — 047 per-branch max shifts

## `staff_branch_schedule_settings` (new, tenant table)

| Column | Type | Rule |
|---|---|---|
| `company_id` | uuid NOT NULL | tenant key, RLS predicate |
| `business_id` | uuid NOT NULL | the branch's business |
| `branch_id` | uuid NOT NULL | FK `(company_id, business_id, branch_id) → branches(company_id, business_id, id)` |
| `max_shifts_per_day` | smallint NOT NULL | CHECK `BETWEEN 1 AND 4` (MS-Q3) |
| `updated_by` | uuid NOT NULL | → `user(id)`, indexed |
| `updated_at` | timestamptz NOT NULL | |

- PK `(company_id, branch_id)`. Index `(company_id, business_id)` (per-business list, template maximum).
- RLS ENABLE + FORCE; `pospay_app` SELECT / INSERT / UPDATE / DELETE on `company_id = app_company_id()`.
- Grants: `SELECT, INSERT, DELETE`, `UPDATE (max_shifts_per_day, updated_by, updated_at)`.
- No backfill. Absence = the branch follows the business number.

## `staff_schedule_settings` (16c) — unchanged

The business number; absence = 3.

## Derived values (pure, `staff/domain/schedule-settings.ts`)

- Branch effective = branch ?? business ?? 3 (MB-Q2).
- Template maximum = max of the active branches' effective values; business ?? 3 when the business has no active
  branch (MB-Q3).

## Audit

Entity `staff_branch_schedule_settings`, entity id = branch id, action `updated` (set/change) or `deleted` (clear),
before/after `{ branch_id, max_shifts_per_day (null when none), source }`.
