# Quickstart — validating 040 employee IBAN

Prerequisites: T2 compose Postgres and Redis up (`docker ps`), `.env` present, `pnpm install`, shared packages built.

1. `pnpm db:migrate` — `employee_ibans` and its policies apply cleanly; the drift check prints "No schema changes".
2. `pnpm --filter @pospay/domain test` — IBAN and bank-list unit tests green.
3. `pnpm --filter @pospay/api test -- employee-iban` — IB-01 … IB-13, the RLS negative and the query EXPLAIN tests
   green.
4. `pnpm --filter @pospay/observability test` — leak-path tests green (no IBAN or holder name in logs).
5. `pnpm --filter @pospay/admin test -- iban` — section, form, history and hook tests green.
6. Manual (dev): as the owner, open an employee → "Bank account (IBAN)" → type
   `KW81 CBKU 0000 0000 0000 1234 5601 01` → the bank "Commercial Bank of Kuwait" is pre-selected → holder name,
   reason → save → the full IBAN is shown. As a branch manager with employee access only → "•••• 0101", no form, no
   history. Save the same IBAN on a second employee as the owner → "already registered to another employee".
