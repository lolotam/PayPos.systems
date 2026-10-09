# Quickstart — validate 038 duplicate-name warning

## Prerequisites

- T2 compose Postgres up (`docker ps` shows it); `.env` points at it.
- `pnpm install`; shared packages built (`pnpm --filter "@pospay/contracts..." --filter "@pospay/i18n..." build`).

## Automated

```bash
pnpm --filter @pospay/contracts test
pnpm --filter @pospay/api test -- employee-name-matches
pnpm --filter @pospay/admin test -- duplicate-name create-employee-form edit-employee-form
pnpm run typecheck && pnpm run lint && pnpm run lint:docs && pnpm run module-map:check
```

Expected: DN-01 … DN-13 green; the EXPLAIN assertion names `employees_company_business_id_idx`.

## Manual (admin)

1. In a business with "Sara Ahmed / سارة أحمد", open **Create employee**, type `sara  ahmed` / `ساره احمد`, save →
   the warning lists her with her branch; **Edit name** keeps the values; **Save anyway** creates the record.
2. Type a new unique name → saved with no warning.
3. Edit another employee, change only the hire date → saved, no warning. Rename her to "Sara Ahmed" → warning,
   never listing herself.
4. As a branch manager of another branch, repeat step 1 → one line "same name in another branch", no details.
