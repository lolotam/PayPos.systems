-- Platform grants and their audit trail — global identity (ADR-0003 §2.1, §3); plan v4 T9a-3.
-- No company_id and no RLS: these rows authorize work before any company exists. pospay_auth reads the grants
-- (path A puts them in the principal) and appends to the audit log; nothing else touches either table. Grants are
-- written only by `pnpm platform:grant`, run as pospay_owner. The audit log is insert-only for every runtime role and
-- readable only by the owner. The privilege suite fails on anything not listed here.
GRANT SELECT ON platform_grants TO pospay_auth;
--> statement-breakpoint
GRANT INSERT ON platform_audit_log TO pospay_auth;
