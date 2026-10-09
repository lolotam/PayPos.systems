# Quickstart — validate 039

Prerequisites: T2 compose Postgres up (`docker ps`), `.env` present, `pnpm install`, shared packages built.

1. `pnpm db:migrate` → the new migration applies. The query
   `SELECT role_id, permission_code FROM role_permissions WHERE role_owner_key = 'global' AND permission_code IN
   ('read:files:business','manage:files:business','manage:document-types:company')` returns only owner rows. Running
   the migration SQL again changes nothing.
2. `pnpm --filter @pospay/db test` — role defaults and eligibility specs green.
3. `pnpm --filter @pospay/api test` (identity, files, staff specs) — ODOC-01…09 green: GM/BM default → 403 on
   documents, document types and import upload; owner ✅; accountant/GM with a personal ALLOW ✅; non-owner editor
   ALLOW → `PERMISSION_OWNER_ONLY`; Device ALLOW → `PERMISSION_ROLE_FORBIDDEN`.
4. Admin: the permissions screen for a general manager lists no files / document-types codes under role defaults.
