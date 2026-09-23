-- ADR-0003 §2.2 — every RLS policy reads the tenant and user context through these two helpers,
-- never through a raw cast: on a pooled connection a setting left over from an earlier transaction
-- survives as '', and ''::uuid raises 22P02 instead of matching nothing.
CREATE FUNCTION app_company_id() RETURNS uuid
  LANGUAGE sql STABLE SET search_path = pg_catalog
  AS $$ SELECT NULLIF(current_setting('app.company_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE SET search_path = pg_catalog
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
-- The roles exist before any migration runs (bootstrapRoles). Table grants arrive with each table.
GRANT USAGE ON SCHEMA public TO pospay_app, pospay_auth;
