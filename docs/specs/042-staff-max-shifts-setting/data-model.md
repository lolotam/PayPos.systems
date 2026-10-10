# Data model — 042 max shifts per day setting

## `staff_schedule_settings` (new, tenant table, owned by `staff`)

| Column | Type | Rule |
|---|---|---|
| `company_id` | `uuid NOT NULL` | tenant key; RLS predicate |
| `business_id` | `uuid NOT NULL` | scope of the setting (MS-Q1: per business) |
| `max_shifts_per_day` | `smallint NOT NULL` | `CHECK (max_shifts_per_day BETWEEN 1 AND 4)` (MS-Q3) |
| `updated_by` | `uuid NOT NULL` | FK `user(id)`; the last person who changed it |
| `updated_at` | `timestamptz NOT NULL` | time of the last change (server time, UTC) |

- **PK** `(company_id, business_id)` — one row per business (same shape as `business_settings`, tenant-qualified, no
  global uniqueness oracle — ADR-0007 spirit).
- **FK** `(company_id, business_id) → businesses(company_id, id)`; `updated_by → user(id)`.
- **Index** `(updated_by)` for the FK. The PK serves the lookup and the RLS predicate (`company_id` leads it).
- **RLS** `ENABLE` + `FORCE`; policies for `pospay_app`: `SELECT` `USING (company_id = app_company_id())`, `INSERT`
  `WITH CHECK (…)`, `UPDATE` `USING (…) WITH CHECK (…)`. No `DELETE` policy and no `DELETE` grant.
- **Grants** to `pospay_app`: `SELECT, INSERT`, `UPDATE (max_shifts_per_day, updated_by, updated_at)`.
- **Absence** of a row = effective value **3** (`is_default = true`). No backfill.

## Derived values

- `effective_max_shifts_per_day(business) = row.max_shifts_per_day ?? 3`.
- `ScheduleGrid.max_shifts_per_day`, `TemplatePage.max_shifts_per_day` carry the effective value.

## Unchanged

- `staff_schedule_shifts` (and its 16 h CHECK), `staff_schedules`, `staff_shift_templates.shifts` (jsonb).

## Audit

One `audit_log` row per actual change, same transaction: entity `staff_schedule_settings` keyed by `business_id`,
`before = { max_shifts_per_day, is_default }`, `after = { max_shifts_per_day }`, actor = the user. A no-op write
records nothing.

## State rules

- Lowering the value never rewrites stored schedules or templates (MS-Q4). It affects only later saves, on the days
  they change; template apply checks every day of the template.
