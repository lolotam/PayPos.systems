CREATE TABLE "line_performers" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"performer_ordinal" integer NOT NULL,
	"share_bps" integer NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text,
	"not_clocked_in_warning" boolean NOT NULL,
	"approved_leave_warning" boolean NOT NULL,
	CONSTRAINT "line_performers_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "line_performers_employee_key" UNIQUE("company_id","line_id","employee_id"),
	CONSTRAINT "line_performers_ordinal_key" UNIQUE("company_id","line_id","performer_ordinal"),
	CONSTRAINT "line_performers_share" CHECK ("line_performers"."share_bps" BETWEEN 1 AND 10000 AND "line_performers"."performer_ordinal" BETWEEN 1 AND 4)
);
--> statement-breakpoint
CREATE TABLE "service_lines" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_by_membership_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"late" boolean NOT NULL,
	"session_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"input_index" integer NOT NULL,
	"status" text NOT NULL,
	"revision" integer NOT NULL,
	"list_price" numeric(14, 3) NOT NULL,
	"price" numeric(14, 3) NOT NULL,
	"discount" numeric(14, 3) NOT NULL,
	"net" numeric(14, 3) NOT NULL,
	"effective_discount_bps" integer NOT NULL,
	"limit_bps_applied" integer,
	"limit_source" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text,
	"catalog_revision" integer NOT NULL,
	"rule_kind" text NOT NULL,
	"rule_pct_bps" integer,
	"rule_fixed_amount" numeric(14, 3),
	"counts_toward_threshold" boolean NOT NULL,
	"has_performer_warning" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_lines_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "service_lines_business_id_key" UNIQUE("company_id","business_id","id"),
	CONSTRAINT "service_lines_session_ordinal_key" UNIQUE("company_id","session_id","ordinal"),
	CONSTRAINT "service_lines_amounts" CHECK ("service_lines"."list_price" >= 0 AND "service_lines"."price" >= 0 AND "service_lines"."discount" BETWEEN 0 AND "service_lines"."price" AND "service_lines"."net" = "service_lines"."price" - "service_lines"."discount"),
	CONSTRAINT "service_lines_bps" CHECK ("service_lines"."effective_discount_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "service_lines_identity" CHECK ("service_lines"."ordinal" BETWEEN 1 AND 20 AND "service_lines"."input_index" BETWEEN 0 AND 19 AND "service_lines"."revision">0 AND "service_lines"."catalog_revision">0 AND "service_lines"."status" IN ('ACTIVE','CANCELLED')),
	CONSTRAINT "service_lines_limit" CHECK (("service_lines"."limit_source"='OWNER' AND "service_lines"."limit_bps_applied" IS NULL) OR ("service_lines"."limit_source"='NOT_CONFIGURED' AND "service_lines"."limit_bps_applied"=0) OR ("service_lines"."limit_source" IN ('PERSON','BUSINESS') AND "service_lines"."limit_bps_applied" BETWEEN 0 AND 10000)),
	CONSTRAINT "service_lines_limit_presence" CHECK (("service_lines"."limit_source"='OWNER')=("service_lines"."limit_bps_applied" IS NULL)),
	CONSTRAINT "service_lines_rule" CHECK ("service_lines"."rule_kind" IN ('FOLLOW_PLAN','ZERO','PCT','FIXED') AND ("service_lines"."rule_kind"='PCT')=("service_lines"."rule_pct_bps" IS NOT NULL) AND ("service_lines"."rule_kind"='FIXED')=("service_lines"."rule_fixed_amount" IS NOT NULL)),
	CONSTRAINT "service_lines_rule_values" CHECK (("service_lines"."rule_pct_bps" IS NULL OR "service_lines"."rule_pct_bps" BETWEEN 0 AND 10000) AND ("service_lines"."rule_fixed_amount" IS NULL OR "service_lines"."rule_fixed_amount">=0))
);
--> statement-breakpoint
CREATE TABLE "service_sessions" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_by_membership_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"late" boolean NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone_masked" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"business_date" date NOT NULL,
	"business_timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_sessions_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "service_sessions_business_id_key" UNIQUE("company_id","business_id","id")
);
--> statement-breakpoint
ALTER TABLE "line_performers" ADD CONSTRAINT "line_performers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_performers" ADD CONSTRAINT "line_performers_line_fk" FOREIGN KEY ("company_id","business_id","line_id") REFERENCES "public"."service_lines"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_performers" ADD CONSTRAINT "line_performers_employee_fk" FOREIGN KEY ("company_id","business_id","employee_id") REFERENCES "public"."employees"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_lines" ADD CONSTRAINT "service_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_lines" ADD CONSTRAINT "service_lines_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_lines" ADD CONSTRAINT "service_lines_session_fk" FOREIGN KEY ("company_id","business_id","session_id") REFERENCES "public"."service_sessions"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_lines" ADD CONSTRAINT "service_lines_service_fk" FOREIGN KEY ("company_id","business_id","service_id") REFERENCES "public"."services"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_lines" ADD CONSTRAINT "service_lines_recorder_fk" FOREIGN KEY ("company_id","recorded_by_membership_id") REFERENCES "public"."memberships"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_sessions" ADD CONSTRAINT "service_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_sessions" ADD CONSTRAINT "service_sessions_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_sessions" ADD CONSTRAINT "service_sessions_branch_fk" FOREIGN KEY ("company_id","business_id","branch_id") REFERENCES "public"."branches"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_sessions" ADD CONSTRAINT "service_sessions_customer_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customers"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_sessions" ADD CONSTRAINT "service_sessions_recorder_fk" FOREIGN KEY ("company_id","recorded_by_membership_id") REFERENCES "public"."memberships"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "line_performers_line_fk_idx" ON "line_performers" USING btree ("company_id","business_id","line_id");--> statement-breakpoint
CREATE INDEX "line_performers_employee_idx" ON "line_performers" USING btree ("company_id","business_id","employee_id","line_id");--> statement-breakpoint
CREATE INDEX "service_lines_session_fk_idx" ON "service_lines" USING btree ("company_id","business_id","session_id");--> statement-breakpoint
CREATE INDEX "service_lines_service_idx" ON "service_lines" USING btree ("company_id","business_id","service_id");--> statement-breakpoint
CREATE INDEX "service_lines_membership_idx" ON "service_lines" USING btree ("company_id","recorded_by_membership_id");--> statement-breakpoint
CREATE INDEX "service_lines_recorder_idx" ON "service_lines" USING btree ("company_id","recorded_by");--> statement-breakpoint
CREATE INDEX "service_lines_late_session_idx" ON "service_lines" USING btree ("company_id","session_id") WHERE "service_lines"."late";--> statement-breakpoint
CREATE INDEX "service_sessions_day_idx" ON "service_sessions" USING btree ("company_id","branch_id","business_date","occurred_at","id");--> statement-breakpoint
CREATE INDEX "service_sessions_branch_fk_idx" ON "service_sessions" USING btree ("company_id","business_id","branch_id");--> statement-breakpoint
CREATE INDEX "service_sessions_customer_day_idx" ON "service_sessions" USING btree ("company_id","customer_id","business_id","business_date","id");--> statement-breakpoint
CREATE INDEX "service_sessions_late_day_idx" ON "service_sessions" USING btree ("company_id","branch_id","business_date","occurred_at","id") WHERE "service_sessions"."late";--> statement-breakpoint
CREATE INDEX "service_sessions_membership_idx" ON "service_sessions" USING btree ("company_id","recorded_by_membership_id");--> statement-breakpoint
CREATE INDEX "service_sessions_recorder_idx" ON "service_sessions" USING btree ("company_id","recorded_by");
--> statement-breakpoint
ALTER TABLE service_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY service_sessions_tenant ON service_sessions FOR ALL TO pospay_app
USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
ALTER TABLE service_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY service_lines_tenant ON service_lines FOR ALL TO pospay_app
USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
ALTER TABLE line_performers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE line_performers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY line_performers_tenant ON line_performers FOR ALL TO pospay_app
USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON service_sessions, service_lines, line_performers FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON service_sessions, service_lines, line_performers TO pospay_app;
--> statement-breakpoint
CREATE FUNCTION orders_check_performers(tenant uuid, line uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE expected boolean; actual boolean; n integer; shares integer;
BEGIN
  SELECT l.has_performer_warning,count(p.id)::integer,coalesce(sum(p.share_bps),0)::integer,
    coalesce(bool_or(p.not_clocked_in_warning OR p.approved_leave_warning),false)
  INTO expected,n,shares,actual FROM public.service_lines l LEFT JOIN public.line_performers p
    ON p.company_id=l.company_id AND p.line_id=l.id
  WHERE l.company_id=tenant AND l.id=line GROUP BY l.has_performer_warning;
  IF NOT FOUND THEN RETURN; END IF;
  IF n NOT BETWEEN 1 AND 4 OR shares<>10000 OR expected<>actual THEN
    RAISE EXCEPTION 'Invalid performer set' USING ERRCODE='23514', CONSTRAINT='service_lines_performer_consistency';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION orders_performer_consistency() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME='service_lines' THEN
    IF TG_OP<>'INSERT' THEN PERFORM public.orders_check_performers(OLD.company_id,OLD.id); END IF;
    IF TG_OP<>'DELETE' THEN PERFORM public.orders_check_performers(NEW.company_id,NEW.id); END IF;
  ELSE
    IF TG_OP<>'INSERT' THEN PERFORM public.orders_check_performers(OLD.company_id,OLD.line_id); END IF;
    IF TG_OP<>'DELETE' THEN PERFORM public.orders_check_performers(NEW.company_id,NEW.line_id); END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION orders_check_performers(uuid,uuid), orders_performer_consistency() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION orders_check_performers(uuid,uuid), orders_performer_consistency() TO pospay_app;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER service_lines_performer_consistency AFTER INSERT OR UPDATE OR DELETE ON service_lines
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orders_performer_consistency();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER line_performers_consistency AFTER INSERT OR UPDATE OR DELETE ON line_performers
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orders_performer_consistency();
--> statement-breakpoint
INSERT INTO permissions(code) VALUES ('record:service-sessions:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,'record:service-sessions:branch' FROM roles r
WHERE r.company_id IS NULL AND r.code IN ('owner','general_manager','business_manager','branch_manager','cashier')
ON CONFLICT DO NOTHING;
