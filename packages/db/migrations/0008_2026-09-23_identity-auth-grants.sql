-- Global identity (ADR-0003 §2.1): Better Auth's tables. No company_id and no tenant RLS — login runs before a
-- tenant is known. They are reachable only by pospay_auth, the role packages/auth connects as; no other role holds
-- any grant on them (pospay_app cannot read a password hash, a session token or a TOTP secret). The privilege
-- suite fails on anything not listed here.
GRANT USAGE ON SCHEMA public TO pospay_auth;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "user", session, account, verification, two_factor TO pospay_auth;
