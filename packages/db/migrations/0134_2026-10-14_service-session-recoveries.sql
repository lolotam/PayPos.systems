CREATE TABLE "service_session_recoveries" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"key_hash" text NOT NULL,
	"business_date" date NOT NULL,
	"business_timezone" text NOT NULL,
	"session_id" uuid,
	"committed_at" timestamp with time zone,
	"issued_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_outcome" text,
	CONSTRAINT "service_session_recoveries_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "service_session_recoveries_attempt_key" UNIQUE("company_id","user_id","business_id","branch_id","operation","key_hash"),
	CONSTRAINT "service_session_recoveries_operation" CHECK ("service_session_recoveries"."operation" IN ('record-service-session','append-service-session-lines')),
	CONSTRAINT "service_session_recoveries_lifetime" CHECK ("service_session_recoveries"."expires_at" > "service_session_recoveries"."issued_at" AND "service_session_recoveries"."expires_at" <= "service_session_recoveries"."issued_at" + interval '168 hours'),
	CONSTRAINT "service_session_recoveries_revoke_pair" CHECK (("service_session_recoveries"."revoked_at" IS NULL) = ("service_session_recoveries"."revoked_outcome" IS NULL)),
	CONSTRAINT "service_session_recoveries_outcome" CHECK ("service_session_recoveries"."revoked_outcome" IS NULL OR "service_session_recoveries"."revoked_outcome" IN ('RECORDED_ELSEWHERE','NOT_RECORDED'))
);
--> statement-breakpoint
ALTER TABLE "service_session_recoveries" ADD CONSTRAINT "service_session_recoveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_session_recoveries" ADD CONSTRAINT "service_session_recoveries_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_session_recoveries" ADD CONSTRAINT "service_session_recoveries_session_fk" FOREIGN KEY ("company_id","business_id","session_id") REFERENCES "public"."service_sessions"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_session_recoveries_branch_fk_idx" ON "service_session_recoveries" USING btree ("company_id","business_id","branch_id");--> statement-breakpoint
CREATE INDEX "service_session_recoveries_session_fk_idx" ON "service_session_recoveries" USING btree ("company_id","business_id","session_id");
--> statement-breakpoint
ALTER TABLE service_session_recoveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_session_recoveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY service_session_recoveries_select ON service_session_recoveries FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY service_session_recoveries_insert ON service_session_recoveries FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY service_session_recoveries_update ON service_session_recoveries FOR UPDATE TO pospay_app
  USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON service_session_recoveries FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON service_session_recoveries TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (session_id, committed_at, last_seen_at, expires_at, revoked_at, revoked_outcome) ON service_session_recoveries TO pospay_app;
--> statement-breakpoint
CREATE FUNCTION service_session_recoveries_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_outcome IS DISTINCT FROM OLD.revoked_outcome) THEN
    RAISE EXCEPTION 'recovery revoke is immutable once set' USING ERRCODE = '23514', CONSTRAINT = 'service_session_recoveries_revoke_immutable';
  END IF;
  IF OLD.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM OLD.session_id THEN
    RAISE EXCEPTION 'recovery session link is immutable once set' USING ERRCODE = '23514', CONSTRAINT = 'service_session_recoveries_session_immutable';
  END IF;
  IF OLD.committed_at IS NOT NULL AND NEW.committed_at IS DISTINCT FROM OLD.committed_at THEN
    RAISE EXCEPTION 'recovery commit time is immutable once set' USING ERRCODE = '23514', CONSTRAINT = 'service_session_recoveries_committed_immutable';
  END IF;
  IF NEW.expires_at > OLD.issued_at + interval '168 hours' THEN
    RAISE EXCEPTION 'recovery expiry exceeds the 168 hour cap' USING ERRCODE = '23514', CONSTRAINT = 'service_session_recoveries_lifetime_cap';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION service_session_recoveries_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION service_session_recoveries_guard() TO pospay_app;
--> statement-breakpoint
CREATE TRIGGER service_session_recoveries_guard BEFORE UPDATE ON service_session_recoveries
  FOR EACH ROW EXECUTE FUNCTION service_session_recoveries_guard();