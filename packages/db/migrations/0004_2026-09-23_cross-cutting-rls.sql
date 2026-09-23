-- Cross-cutting RLS and grants — plan v4 T7; ADR-0003 §3 (outbox, idempotency in the USER scope).
-- Same rules as 0002: context through app_company_id() / app_user_id(), policies split by command,
-- WITH CHECK explicit. The privilege suite fails on any grant not listed in its allowlist.

-- outbox: the app only appends. Reading and marking rows is the dispatcher's job (T7b, its own role).
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY outbox_insert ON outbox FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT INSERT ON outbox TO pospay_app;
--> statement-breakpoint

-- audit_log: insert-only and kept forever. No UPDATE or DELETE grant exists, so no policy is needed for them.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_log_select ON audit_log FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY audit_log_insert ON audit_log FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log TO pospay_app;
--> statement-breakpoint

-- idempotency_keys: COMPANY rows belong to the current company, USER rows to the current user.
-- UPDATE only reaches a row whose response is still NULL — that is, only inside the transaction that
-- claimed it; once committed, a stored response can never be overwritten. No DELETE grant: expired rows
-- are swept outside the request path (T7b).
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY idempotency_keys_select ON idempotency_keys FOR SELECT TO pospay_app
  USING ((scope_type = 'COMPANY' AND company_id = app_company_id())
      OR (scope_type = 'USER' AND user_id = app_user_id()));
--> statement-breakpoint
CREATE POLICY idempotency_keys_insert ON idempotency_keys FOR INSERT TO pospay_app
  WITH CHECK ((scope_type = 'COMPANY' AND company_id = app_company_id())
      OR (scope_type = 'USER' AND user_id = app_user_id()));
--> statement-breakpoint
CREATE POLICY idempotency_keys_update ON idempotency_keys FOR UPDATE TO pospay_app
  USING (response_status IS NULL
     AND ((scope_type = 'COMPANY' AND company_id = app_company_id())
       OR (scope_type = 'USER' AND user_id = app_user_id())))
  WITH CHECK ((scope_type = 'COMPANY' AND company_id = app_company_id())
      OR (scope_type = 'USER' AND user_id = app_user_id()));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON idempotency_keys TO pospay_app;
--> statement-breakpoint

-- A claim without a stored response must never commit: that would be the persisted IN_FLIGHT state plan v4
-- rules out. The check runs at COMMIT (deferred) and re-reads the row, because a deferred trigger's NEW is
-- the row as inserted, before the response was written. SECURITY INVOKER: it reads under the caller's RLS.
CREATE FUNCTION idempotency_keys_require_response() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM idempotency_keys k
    WHERE k.scope_type = NEW.scope_type AND k.scope_id = NEW.scope_id
      AND k.operation = NEW.operation AND k.key = NEW.key AND k.response_status IS NULL
  ) THEN
    RAISE EXCEPTION 'idempotency key committed without a stored response'
      USING ERRCODE = '23514', CONSTRAINT = 'idempotency_keys_require_response';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION idempotency_keys_require_response() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER idempotency_keys_require_response
  AFTER INSERT OR UPDATE ON idempotency_keys
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION idempotency_keys_require_response();
