CREATE TABLE "service_line_edits" (
	"company_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"previous_revision" integer NOT NULL,
	"previous_price" numeric(14, 3) NOT NULL,
	"previous_discount" numeric(14, 3) NOT NULL,
	"previous_net" numeric(14, 3) NOT NULL,
	"new_price" numeric(14, 3) NOT NULL,
	"new_discount" numeric(14, 3) NOT NULL,
	"new_net" numeric(14, 3) NOT NULL,
	"previous_effective_discount_bps" integer NOT NULL,
	"previous_limit_bps_applied" integer,
	"previous_limit_source" text NOT NULL,
	"new_effective_discount_bps" integer NOT NULL,
	"new_limit_bps_applied" integer,
	"new_limit_source" text NOT NULL,
	"reason" text NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"changed_by" uuid NOT NULL,
	"changed_by_membership_id" uuid NOT NULL,
	"editor_name_ar" text,
	"editor_name_en" text,
	"editor_role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_line_edits_company_id_id_pk" PRIMARY KEY("company_id","id"),
	CONSTRAINT "service_line_edits_line_revision_key" UNIQUE("company_id","line_id","revision"),
	CONSTRAINT "service_line_edits_revision" CHECK ("service_line_edits"."revision" = "service_line_edits"."previous_revision" + 1 AND "service_line_edits"."previous_revision" >= 1),
	CONSTRAINT "service_line_edits_previous_amounts" CHECK ("service_line_edits"."previous_price" >= 0 AND "service_line_edits"."previous_discount" BETWEEN 0 AND "service_line_edits"."previous_price" AND "service_line_edits"."previous_net" = "service_line_edits"."previous_price" - "service_line_edits"."previous_discount"),
	CONSTRAINT "service_line_edits_new_amounts" CHECK ("service_line_edits"."new_price" >= 0 AND "service_line_edits"."new_discount" BETWEEN 0 AND "service_line_edits"."new_price" AND "service_line_edits"."new_net" = "service_line_edits"."new_price" - "service_line_edits"."new_discount"),
	CONSTRAINT "service_line_edits_previous_bps" CHECK ("service_line_edits"."previous_effective_discount_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "service_line_edits_new_bps" CHECK ("service_line_edits"."new_effective_discount_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "service_line_edits_previous_limit" CHECK (("service_line_edits"."previous_limit_source"='OWNER' AND "service_line_edits"."previous_limit_bps_applied" IS NULL) OR ("service_line_edits"."previous_limit_source"='NOT_CONFIGURED' AND "service_line_edits"."previous_limit_bps_applied"=0) OR ("service_line_edits"."previous_limit_source" IN ('PERSON','BUSINESS') AND "service_line_edits"."previous_limit_bps_applied" BETWEEN 0 AND 10000)),
	CONSTRAINT "service_line_edits_previous_limit_presence" CHECK (("service_line_edits"."previous_limit_source"='OWNER')=("service_line_edits"."previous_limit_bps_applied" IS NULL)),
	CONSTRAINT "service_line_edits_new_limit" CHECK (("service_line_edits"."new_limit_source"='OWNER' AND "service_line_edits"."new_limit_bps_applied" IS NULL) OR ("service_line_edits"."new_limit_source"='NOT_CONFIGURED' AND "service_line_edits"."new_limit_bps_applied"=0) OR ("service_line_edits"."new_limit_source" IN ('PERSON','BUSINESS') AND "service_line_edits"."new_limit_bps_applied" BETWEEN 0 AND 10000)),
	CONSTRAINT "service_line_edits_new_limit_presence" CHECK (("service_line_edits"."new_limit_source"='OWNER')=("service_line_edits"."new_limit_bps_applied" IS NULL)),
	CONSTRAINT "service_line_edits_reason" CHECK (char_length(btrim("service_line_edits"."reason")) BETWEEN 1 AND 500),
	CONSTRAINT "service_line_edits_editor_names" CHECK ("service_line_edits"."editor_name_ar" IS NULL OR "service_line_edits"."editor_name_en" IS NOT NULL),
	CONSTRAINT "service_line_edits_editor_role" CHECK ("service_line_edits"."editor_role" IN ('owner','manager'))
);
--> statement-breakpoint
ALTER TABLE "service_line_edits" ADD CONSTRAINT "service_line_edits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_line_edits" ADD CONSTRAINT "service_line_edits_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_line_edits" ADD CONSTRAINT "service_line_edits_session_fk" FOREIGN KEY ("company_id","business_id","session_id") REFERENCES "public"."service_sessions"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_line_edits" ADD CONSTRAINT "service_line_edits_line_fk" FOREIGN KEY ("company_id","business_id","line_id") REFERENCES "public"."service_lines"("company_id","business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_line_edits" ADD CONSTRAINT "service_line_edits_membership_fk" FOREIGN KEY ("company_id","changed_by_membership_id") REFERENCES "public"."memberships"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_line_edits_session_fk_idx" ON "service_line_edits" USING btree ("company_id","business_id","session_id");--> statement-breakpoint
CREATE INDEX "service_line_edits_line_fk_idx" ON "service_line_edits" USING btree ("company_id","business_id","line_id");--> statement-breakpoint
CREATE INDEX "service_line_edits_membership_idx" ON "service_line_edits" USING btree ("company_id","changed_by_membership_id");--> statement-breakpoint
CREATE INDEX "service_line_edits_changed_by_fk_idx" ON "service_line_edits" USING btree ("changed_by");
--> statement-breakpoint
ALTER TABLE service_line_edits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_line_edits FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY service_line_edits_select ON service_line_edits FOR SELECT TO pospay_app
  USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY service_line_edits_insert ON service_line_edits FOR INSERT TO pospay_app
  WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
REVOKE ALL ON service_line_edits FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;
--> statement-breakpoint
GRANT SELECT, INSERT ON service_line_edits TO pospay_app;
--> statement-breakpoint
GRANT UPDATE (price, discount, net, effective_discount_bps, limit_bps_applied, limit_source, revision) ON service_lines TO pospay_app;
--> statement-breakpoint
INSERT INTO permissions(code) VALUES ('edit:service-line-prices:branch') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
SELECT r.id,'global',NULL,'edit:service-line-prices:branch' FROM roles r
WHERE r.company_id IS NULL AND r.code IN ('owner','general_manager','business_manager','branch_manager')
ON CONFLICT DO NOTHING;